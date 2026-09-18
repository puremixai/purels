package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/purels/purels/internal/domain"
)

// ListRoles returns every role, alphabetically so the console shows them in a
// stable order.
func (s *Store) ListRoles(ctx context.Context) ([]domain.Role, error) {
	rows, err := s.Pool.Query(ctx, `SELECT name, scopes, unrestricted FROM roles ORDER BY name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	roles := make([]domain.Role, 0)
	for rows.Next() {
		var role domain.Role
		var rawScopes []byte
		if err := rows.Scan(&role.Name, &rawScopes, &role.Unrestricted); err != nil {
			return nil, err
		}
		role.Scopes = parseScopes(rawScopes)
		roles = append(roles, role)
	}
	return roles, rows.Err()
}

// GetRole returns one role. It is what validates a role name before it is
// written to an account: the roles table is the authority, not a list in code.
func (s *Store) GetRole(ctx context.Context, name string) (domain.Role, error) {
	var role domain.Role
	var rawScopes []byte
	err := s.Pool.QueryRow(ctx, `SELECT name, scopes, unrestricted FROM roles WHERE name=$1`, name).
		Scan(&role.Name, &rawScopes, &role.Unrestricted)
	if errors.Is(err, pgx.ErrNoRows) {
		return role, ErrNotFound
	}
	if err != nil {
		return role, err
	}
	role.Scopes = parseScopes(rawScopes)
	return role, nil
}

// authzLockKey namespaces the advisory lock that serialises the two writes
// that can remove a capability: editing a role, and moving an account to a
// different role. Without it, two concurrent edits could each demote a
// different holder, each observe the other still in place, and commit into a
// state where nobody can administer the console. The value is arbitrary but
// must never collide with another advisory lock in this process.
const authzLockKey = 0x707572656c73 // "purels"

// lockAuthz takes the transaction-scoped advisory lock described above. It is
// released when the transaction ends, whether it commits or rolls back.
func lockAuthz(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, authzLockKey)
	return err
}

// requireCapabilityHolders fails when no enabled account still holds one of the
// capabilities the console cannot be administered without.
//
// It counts by capability rather than by role name: the moment a role other
// than admin can hold the scope, counting rows where role='admin' would protect
// nothing.
func requireCapabilityHolders(ctx context.Context, tx pgx.Tx) error {
	for _, required := range []string{domain.ScopeUsersManage, domain.ScopeRolesManage} {
		var holders int64
		if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM admin_users u JOIN roles r ON r.name=u.role
			WHERE u.disabled=false AND r.scopes @> jsonb_build_array($1::text)`, required).Scan(&holders); err != nil {
			return err
		}
		if holders == 0 {
			return fmt.Errorf("%w: %s", ErrLastCapabilityHolder, required)
		}
	}
	return nil
}

// UpdateRoleScopes replaces a role's scope set and visibility flag.
//
// The guard lives here rather than in the service because it has to run in the
// same transaction as the write, under the lock that keeps a concurrent account
// edit from slipping past it.
func (s *Store) UpdateRoleScopes(ctx context.Context, role domain.Role) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := lockAuthz(ctx, tx); err != nil {
		return err
	}

	result, err := tx.Exec(ctx, `UPDATE roles SET scopes=$2, unrestricted=$3, updated_at=now() WHERE name=$1`,
		role.Name, role.Scopes, role.Unrestricted)
	if err != nil {
		return normalizeDBError(err)
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	if err := requireCapabilityHolders(ctx, tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
