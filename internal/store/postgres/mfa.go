package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/purels/purels/internal/domain"
)

// GetMFAState returns what the login path needs to know about an account's
// second factor.
//
// The secret comes back as stored — ciphertext — because only the service holds
// the key. Nothing here can tell whether a secret is readable, and that is
// deliberate: the store must not be able to make a trust decision about a value
// it cannot interpret.
func (s *Store) GetMFAState(ctx context.Context, userID string) (domain.MFAState, error) {
	var state domain.MFAState
	err := s.Pool.QueryRow(ctx, `SELECT totp_secret, totp_confirmed_at FROM admin_users WHERE id=$1`, userID).
		Scan(&state.Secret, &state.ConfirmedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return state, ErrNotFound
	}
	return state, err
}

// SetTOTPSecret stores a fresh enrolment secret and clears the confirmation, so
// re-enrolling starts from "unconfirmed" even if the account was already using
// the second factor. Existing recovery codes are deleted in the same
// transaction: they belong to the secret being replaced, and leaving them alive
// would keep the old factor usable after the operator thought they had replaced
// it.
func (s *Store) SetTOTPSecret(ctx context.Context, userID string, secret []byte) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	result, err := tx.Exec(ctx, `UPDATE admin_users SET totp_secret=$2, totp_confirmed_at=NULL, updated_at=now() WHERE id=$1`, userID, secret)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	if _, err := tx.Exec(ctx, `DELETE FROM mfa_recovery_codes WHERE user_id=$1`, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ConfirmTOTP marks the enrolment complete and installs the recovery codes. It
// is one transaction because a confirmed account with no recovery codes is a
// trap: the codes are the only way in when the authenticator is lost.
func (s *Store) ConfirmTOTP(ctx context.Context, userID string, codeHashes [][]byte) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	result, err := tx.Exec(ctx, `UPDATE admin_users SET totp_confirmed_at=now(), updated_at=now() WHERE id=$1 AND totp_secret IS NOT NULL`, userID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	if _, err := tx.Exec(ctx, `DELETE FROM mfa_recovery_codes WHERE user_id=$1`, userID); err != nil {
		return err
	}
	for _, hash := range codeHashes {
		if _, err := tx.Exec(ctx, `INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1,$2)`, userID, hash); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ClearTOTP removes the secret, the confirmation and every recovery code. The
// account returns to password-only.
func (s *Store) ClearTOTP(ctx context.Context, userID string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	result, err := tx.Exec(ctx, `UPDATE admin_users SET totp_secret=NULL, totp_confirmed_at=NULL, updated_at=now() WHERE id=$1`, userID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	if _, err := tx.Exec(ctx, `DELETE FROM mfa_recovery_codes WHERE user_id=$1`, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// CountRecoveryCodes returns how many unused codes remain, so the console can
// warn before the last one is spent.
func (s *Store) CountRecoveryCodes(ctx context.Context, userID string) (int, error) {
	var total int
	err := s.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM mfa_recovery_codes WHERE user_id=$1 AND used_at IS NULL`, userID).Scan(&total)
	return total, err
}

// CreateMFAChallenge records a half-session for userID.
//
// Expired rows are swept here rather than by a background job: the table only
// grows when somebody signs in, so the write that creates a row is the natural
// place to remove the ones nobody can use, and no separate schedule has to be
// kept in step.
func (s *Store) CreateMFAChallenge(ctx context.Context, userID string, tokenHash []byte, expiresAt time.Time) error {
	if _, err := s.Pool.Exec(ctx, `DELETE FROM mfa_challenges WHERE expires_at < now()`); err != nil {
		return err
	}
	_, err := s.Pool.Exec(ctx, `INSERT INTO mfa_challenges (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`, userID, tokenHash, expiresAt)
	return err
}

// ClaimMFAChallenge spends one attempt on a challenge and reports whose it is.
//
// The increment and the eligibility check are one statement, so concurrent
// guesses cannot each read a fresh counter: the second UPDATE blocks on the row
// lock and then re-evaluates its predicate against the incremented value. A
// false return means the challenge is unknown, expired, already used, or out of
// attempts — the caller must not distinguish between those.
//
// This is the real brute-force bound. The rate limiter is fail-open when Redis
// is unavailable; a counter inside the row is not.
func (s *Store) ClaimMFAChallenge(ctx context.Context, tokenHash []byte, maxAttempts int) (string, bool, error) {
	var userID string
	err := s.Pool.QueryRow(ctx, `
		UPDATE mfa_challenges SET attempts = attempts + 1
		WHERE token_hash=$1 AND expires_at > now() AND consumed_at IS NULL AND attempts < $2
		RETURNING user_id`, tokenHash, maxAttempts).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return userID, true, nil
}

// ConsumeMFAChallenge retires a challenge once its code has been accepted, so
// the same half-session cannot mint a second session.
func (s *Store) ConsumeMFAChallenge(ctx context.Context, tokenHash []byte) error {
	_, err := s.Pool.Exec(ctx, `UPDATE mfa_challenges SET consumed_at=now() WHERE token_hash=$1 AND consumed_at IS NULL`, tokenHash)
	return err
}

// SpendRecoveryCode marks one code used and reports whether it was still
// unused. The check and the write are one statement, so two simultaneous
// submissions of the same code cannot both succeed.
func (s *Store) SpendRecoveryCode(ctx context.Context, userID string, codeHash []byte) (bool, error) {
	result, err := s.Pool.Exec(ctx, `UPDATE mfa_recovery_codes SET used_at=now() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL`, userID, codeHash)
	if err != nil {
		return false, err
	}
	return result.RowsAffected() > 0, nil
}

// PurgeExpiredMFAChallenges removes half-sessions nobody can use any more. It
// exists for the tests and for an operator who wants the table swept on demand;
// CreateMFAChallenge already does this on every sign-in.
func (s *Store) PurgeExpiredMFAChallenges(ctx context.Context) (int64, error) {
	result, err := s.Pool.Exec(ctx, `DELETE FROM mfa_challenges WHERE expires_at < now()`)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}
