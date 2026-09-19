package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/purels/purels/internal/domain"
)

// linkSorts is a whitelist mapping public sort keys to SQL fragments.
// Anything not listed falls back to newest first, so the value is never
// interpolated from raw user input.
var linkSorts = map[string]string{
	"created_at_desc": "l.created_at DESC",
	"created_at_asc":  "l.created_at ASC",
	"alias_asc":       "l.alias ASC",
	"alias_desc":      "l.alias DESC",
	// COALESCE is required: links with no clicks join to NULL, and PostgreSQL
	// sorts NULLs first under DESC, which would float unclicked links to the top.
	"clicks_desc": "COALESCE(c.clicks,0) DESC, l.created_at DESC",
	"clicks_asc":  "COALESCE(c.clicks,0) ASC, l.created_at DESC",
}

// linkTagsColumn aggregates a link's tag names into a text[] so the list query
// stays a single round trip instead of one tag lookup per row.
const linkTagsColumn = `COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = l.id), '{}')`

// linkRulesColumn aggregates a link's divert rules into a jsonb array, in the
// order they are matched. A NULL redirect_code means "inherit the link's", which
// reads back as 0.
const linkRulesColumn = `COALESCE((SELECT jsonb_agg(jsonb_build_object(
	'id', r.id,
	'position', r.position,
	'match_type', r.match_type,
	'match_value', r.match_value,
	'destination_url', r.destination_url,
	'redirect_code', COALESCE(r.redirect_code, 0)) ORDER BY r.position, r.created_at)
	FROM link_rules r WHERE r.link_id = l.id), '[]')`

const linkSelectColumns = `l.id, l.alias, l.destination_url, l.title, l.redirect_code, l.status, l.version, l.expires_at, l.created_at, l.updated_at, l.last_checked_at, l.last_status_code, COALESCE(c.clicks,0), ` + linkTagsColumn + `, COALESCE(l.domain,'')`

// linkSingleColumns is the column list for lookups that do not join the daily
// aggregation: linkSelectColumns without the click count, plus the divert rules.
//
// Rules are appended here and deliberately not to linkSelectColumns: a rule is
// a property of one redirect, so the list, the export and the rankings have no
// use for them and would pay a subquery per row for nothing.
const linkSingleColumns = `l.id, l.alias, l.destination_url, l.title, l.redirect_code, l.status, l.version, l.expires_at, l.created_at, l.updated_at, l.last_checked_at, l.last_status_code, ` + linkTagsColumn + `, ` + linkRulesColumn + `, COALESCE(l.domain,'')`

// linkClickJoin aggregates each link's clicks from the daily rollup. COALESCE
// keeps links that have never been clicked out of the NULL bucket.
func (s *Store) linkClickJoin() string {
	return `LEFT JOIN (SELECT link_id, SUM(` + s.clickCount("clicks", "bot_clicks") + `) AS clicks FROM link_click_daily GROUP BY link_id) c ON c.link_id=l.id`
}

// clickCount renders the click expression a statistic should report. Bot clicks
// are always stored; CountBots decides whether they are included.
func (s *Store) clickCount(clicks, botClicks string) string {
	if s.CountBots {
		return clicks
	}
	return clicks + " - " + botClicks
}

// notBot renders the clause that hides bot events from a statistic that reads
// the raw event table. It is empty when bot traffic is being counted.
func (s *Store) notBot(column string) string {
	if s.CountBots {
		return ""
	}
	return " AND NOT " + column
}

// CreateAdminIfMissing inserts the bootstrap administrator. The role is set
// explicitly rather than relying on the column default: the migration that
// introduced the column promotes the accounts that already existed, and on a
// fresh database there are none to promote.
func (s *Store) CreateAdminIfMissing(ctx context.Context, username, passwordHash string) error {
	_, err := s.Pool.Exec(ctx, `INSERT INTO admin_users (username, password_hash, role) VALUES ($1,$2,$3) ON CONFLICT (username) DO NOTHING`,
		strings.ToLower(strings.TrimSpace(username)), passwordHash, domain.RoleAdmin)
	return err
}

// CreateUser registers a regular account. A duplicate username surfaces as
// ErrConflict through normalizeDBError.
func (s *Store) CreateUser(ctx context.Context, id, username, passwordHash, role string) error {
	_, err := s.Pool.Exec(ctx, `INSERT INTO admin_users (id, username, password_hash, role) VALUES ($1,$2,$3,$4)`, id, username, passwordHash, role)
	return normalizeDBError(err)
}

// ListUsers returns every account, oldest first so the bootstrap administrator
// stays at the top of the list.
func (s *Store) ListUsers(ctx context.Context) ([]domain.Account, error) {
	rows, err := s.Pool.Query(ctx, `SELECT id, username, role, disabled, totp_confirmed_at IS NOT NULL, created_at FROM admin_users ORDER BY created_at ASC, username ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	accounts := make([]domain.Account, 0)
	for rows.Next() {
		var account domain.Account
		if err := rows.Scan(&account.ID, &account.Username, &account.Role, &account.Disabled, &account.MFAEnabled, &account.CreatedAt); err != nil {
			return nil, err
		}
		accounts = append(accounts, account)
	}
	return accounts, rows.Err()
}

// UpdateUser changes a role and/or the disabled flag. A nil field is left
// untouched, so the caller can flip one without restating the other.
//
// The capability guard lives here rather than in the service because it has to
// run in the same transaction as the write. Losing the last account able to
// administer users — or to edit roles — has no recovery path through the
// console, so the whole update is rolled back instead.
func (s *Store) UpdateUser(ctx context.Context, id string, role *string, disabled *bool) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := lockAuthz(ctx, tx); err != nil {
		return err
	}
	result, err := tx.Exec(ctx, `UPDATE admin_users SET role=COALESCE($2, role), disabled=COALESCE($3, disabled), updated_at=now() WHERE id=$1`, id, role, disabled)
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

func (s *Store) FindUser(ctx context.Context, username string) (domain.User, string, bool, error) {
	var user domain.User
	var hash string
	var disabled bool
	err := s.Pool.QueryRow(ctx, `SELECT id, username, role, password_hash, disabled FROM admin_users WHERE username=$1`, username).Scan(&user.ID, &user.Username, &user.Role, &hash, &disabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return user, "", false, nil
	}
	return user, hash, !disabled, err
}

func (s *Store) CreateSession(ctx context.Context, userID string, tokenHash, csrfHash, ipHash []byte, userAgent string, expires time.Time) error {
	_, err := s.Pool.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, csrf_hash, expires_at, user_agent, ip_hash) VALUES ($1,$2,$3,$4,$5,$6)`, userID, tokenHash, csrfHash, expires, userAgent, ipHash)
	return err
}

// GetSession resolves a session token to its session and account.
//
// The account's role is joined rather than looked up separately: the scopes and
// the visibility flag are what authorize every request, and reading them here
// means a role edit takes effect on the account's next request instead of at
// its next sign-in. It also means the role row must exist — which the foreign
// key on admin_users.role guarantees, because an inner join that found nothing
// would read as "no session" and silently sign the account out.
func (s *Store) GetSession(ctx context.Context, tokenHash []byte) (domain.Session, bool, error) {
	var session domain.Session
	var userID, username, role string
	var rawScopes []byte
	var unrestricted, mfaEnabled bool
	err := s.Pool.QueryRow(ctx, `
		SELECT s.id, s.csrf_hash, s.expires_at, u.id, u.username, u.role, r.scopes, r.unrestricted, u.totp_confirmed_at IS NOT NULL
		FROM sessions s
		JOIN admin_users u ON u.id=s.user_id
		JOIN roles r ON r.name=u.role
		WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.disabled=false`, tokenHash).
		Scan(&session.ID, &session.CSRFHash, &session.ExpiresAt, &userID, &username, &role, &rawScopes, &unrestricted, &mfaEnabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return session, false, nil
	}
	if err != nil {
		return session, false, err
	}
	session.User = domain.User{ID: userID, Username: username, Role: role, Scopes: parseScopes(rawScopes), Unrestricted: unrestricted, MFAEnabled: mfaEnabled}
	_, _ = s.Pool.Exec(ctx, `UPDATE sessions SET last_seen_at=now() WHERE id=$1`, session.ID)
	return session, true, nil
}

func (s *Store) RevokeSession(ctx context.Context, tokenHash []byte) error {
	_, err := s.Pool.Exec(ctx, `UPDATE sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL`, tokenHash)
	return err
}

// GetUserByID returns one account with its role's permissions, the same shape
// GetSession produces. A completed second factor needs it: the session is
// created from a user id, and the response has to describe the account.
//
// A disabled account is reported as missing, which is how a login that was
// interrupted by a second factor cannot outlive a disable that happened while
// the challenge was outstanding.
func (s *Store) GetUserByID(ctx context.Context, id string) (domain.User, error) {
	var user domain.User
	var rawScopes []byte
	err := s.Pool.QueryRow(ctx, `
		SELECT u.id, u.username, u.role, r.scopes, r.unrestricted, u.totp_confirmed_at IS NOT NULL
		FROM admin_users u
		JOIN roles r ON r.name=u.role
		WHERE u.id=$1 AND u.disabled=false`, id).
		Scan(&user.ID, &user.Username, &user.Role, &rawScopes, &user.Unrestricted, &user.MFAEnabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return user, ErrNotFound
	}
	if err != nil {
		return user, err
	}
	user.Scopes = parseScopes(rawScopes)
	return user, nil
}

// CreateLink inserts a link owned by ownerID. A nil owner leaves user_id NULL,
// which is the pre-ownership state and is visible to administrators only.
func (s *Store) CreateLink(ctx context.Context, link domain.Link, ownerID *string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	_, err = tx.Exec(ctx, `INSERT INTO links (id, alias, destination_url, title, redirect_code, status, version, expires_at, created_at, updated_at, user_id, domain) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,NULLIF($11,''))`,
		link.ID, link.Alias, link.DestinationURL, link.Title, link.RedirectCode, link.Status, link.Version, link.ExpiresAt, link.CreatedAt, ownerID, link.Domain)
	if err != nil {
		return normalizeDBError(err)
	}
	if err := setLinkTags(ctx, tx, link.ID, link.Tags); err != nil {
		return err
	}
	// A link that was just inserted has no rules to delete, so this is a plain
	// insert; skipping it when there are none saves a statement per create.
	if len(link.Rules) > 0 {
		if err := setLinkRules(ctx, tx, link.ID, link.Rules); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// setLinkTags replaces a link's tags wholesale. Callers pass the complete
// desired set, so the delete-then-insert keeps the join table in step without
// having to diff it.
func setLinkTags(ctx context.Context, tx pgx.Tx, linkID string, tags []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM link_tags WHERE link_id=$1`, linkID); err != nil {
		return err
	}
	for _, name := range tags {
		var tagID string
		// DO UPDATE (rather than DO NOTHING) so RETURNING still yields the id of
		// the pre-existing tag row.
		if err := tx.QueryRow(ctx, `INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id`, name).Scan(&tagID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO link_tags (link_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, linkID, tagID); err != nil {
			return err
		}
	}
	return nil
}

// setLinkRules replaces a link's divert rules wholesale, the same way
// setLinkTags replaces its tags: the caller passes the complete desired set, in
// match order, so the delete-then-insert needs no diffing. The position column
// comes from the slice index rather than from the caller.
func setLinkRules(ctx context.Context, tx pgx.Tx, linkID string, rules []domain.LinkRule) error {
	if _, err := tx.Exec(ctx, `DELETE FROM link_rules WHERE link_id=$1`, linkID); err != nil {
		return err
	}
	for position, rule := range rules {
		// A zero code means "inherit the link's", which is stored as NULL.
		var code *int16
		if rule.RedirectCode != 0 {
			code = &rule.RedirectCode
		}
		if _, err := tx.Exec(ctx, `INSERT INTO link_rules (link_id, position, match_type, match_value, destination_url, redirect_code) VALUES ($1,$2,$3,$4,$5,$6)`,
			linkID, position, rule.MatchType, rule.MatchValue, rule.DestinationURL, code); err != nil {
			return err
		}
	}
	return nil
}

// NextAliasValue returns the next value of the sequential-alias sequence.
// Values are handed out even if the caller then rolls back, so gaps are normal.
func (s *Store) NextAliasValue(ctx context.Context) (int64, error) {
	var value int64
	err := s.Pool.QueryRow(ctx, `SELECT nextval('link_alias_seq')`).Scan(&value)
	return value, err
}

// GetLinkByAlias returns a live link by its short code. Soft-deleted links are
// excluded so callers cannot resolve a short code that was retired.
func (s *Store) GetLinkByAlias(ctx context.Context, alias string) (domain.Link, error) {
	return s.scanLink(s.Pool.QueryRow(ctx, `SELECT `+linkSingleColumns+` FROM links l WHERE l.alias=$1 AND l.deleted_at IS NULL`, alias))
}

// FindLiveLinkByDestination returns the oldest link for a destination that the
// actor owns and that can still be resolved. Oldest rather than newest so
// UNIQUE_URLS keeps handing back a stable code.
//
// The owner is matched exactly rather than through the unrestricted scope: an
// administrator re-shortening a destination somebody else already shortened
// gets a code of their own instead of being handed a link they do not own.
// Liveness is checked here so a disabled or expired link is never handed back
// as a reusable code.
func (s *Store) FindLiveLinkByDestination(ctx context.Context, destination, ownerID string) (domain.Link, error) {
	return s.scanLink(s.Pool.QueryRow(ctx, `SELECT `+linkSingleColumns+` FROM links l
		WHERE l.destination_url=$1 AND l.user_id=$2 AND l.deleted_at IS NULL AND l.status='active'
			AND (l.expires_at IS NULL OR l.expires_at > now())
		ORDER BY l.created_at ASC LIMIT 1`, destination, ownerID))
}

// GetLink returns one link. ownerID nil means no restriction (the
// administrator's view); otherwise the link must belong to that account.
func (s *Store) GetLink(ctx context.Context, id string, ownerID *string) (domain.Link, error) {
	// deleted_at IS NULL, like every other link query here. Without it a deleted
	// link stayed readable by id — the redirect, the preview page and PATCH all
	// 404'd while GET answered 200 with the full record.
	return s.scanLink(s.Pool.QueryRow(ctx, `SELECT `+linkSingleColumns+` FROM links l WHERE l.id=$1 AND l.deleted_at IS NULL AND ($2::uuid IS NULL OR l.user_id=$2)`, id, ownerID))
}

func (s *Store) scanLink(row pgx.Row) (domain.Link, error) {
	var link domain.Link
	var rawRules []byte
	err := row.Scan(&link.ID, &link.Alias, &link.DestinationURL, &link.Title, &link.RedirectCode, &link.Status, &link.Version, &link.ExpiresAt, &link.CreatedAt, &link.UpdatedAt, &link.LastCheckedAt, &link.LastStatusCode, &link.Tags, &rawRules, &link.Domain)
	if errors.Is(err, pgx.ErrNoRows) {
		return link, ErrNotFound
	}
	if err != nil {
		// Through normalizeDBError like every other store method: a malformed id
		// fails in the scan as SQLSTATE 22P02, and returning it raw would carry
		// Postgres' own text back to the caller.
		return link, normalizeDBError(err)
	}
	link.Rules = parseRules(rawRules)
	return link, nil
}

// parseRules decodes the rules jsonb column. A missing, null or malformed value
// yields no rules, so a corrupt row sends the visitor to the link's own
// destination rather than failing the redirect outright.
func parseRules(raw []byte) []domain.LinkRule {
	rules := make([]domain.LinkRule, 0)
	if len(raw) == 0 {
		return rules
	}
	if err := json.Unmarshal(raw, &rules); err != nil || rules == nil {
		return make([]domain.LinkRule, 0)
	}
	return rules
}

// buildLinkWhere renders the shared filter clause for list and export queries.
// Filter values are always passed as bind parameters; only placeholders and
// fixed SQL fragments are interpolated.
func buildLinkWhere(filter domain.ListFilter) (string, []any) {
	conditions := []string{"l.deleted_at IS NULL"}
	args := []any{}
	if filter.OwnerID != nil {
		args = append(args, filter.OwnerID)
		placeholder := fmt.Sprintf("$%d", len(args))
		conditions = append(conditions, fmt.Sprintf("l.user_id = %s", placeholder))
	}
	if filter.Search != "" {
		args = append(args, filter.Search)
		placeholder := fmt.Sprintf("$%d", len(args))
		conditions = append(conditions, fmt.Sprintf("(l.alias ILIKE '%%' || %s || '%%' OR l.destination_url ILIKE '%%' || %s || '%%' OR l.title ILIKE '%%' || %s || '%%')", placeholder, placeholder, placeholder))
	}
	if filter.Tag != "" {
		args = append(args, filter.Tag)
		placeholder := fmt.Sprintf("$%d", len(args))
		conditions = append(conditions, fmt.Sprintf("EXISTS (SELECT 1 FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = l.id AND t.name = %s)", placeholder))
	}
	switch filter.Status {
	case "active":
		conditions = append(conditions, "l.status = 'active'")
	case "disabled":
		conditions = append(conditions, "l.status = 'disabled'")
	case "expired":
		conditions = append(conditions, "l.expires_at IS NOT NULL AND l.expires_at <= now()")
	}
	return "WHERE " + strings.Join(conditions, " AND "), args
}

func linkOrder(sort string) string {
	if order, ok := linkSorts[sort]; ok {
		return order
	}
	return linkSorts["created_at_desc"]
}

func scanLinkRanks(rows pgx.Rows) ([]domain.LinkRank, error) {
	links := make([]domain.LinkRank, 0)
	for rows.Next() {
		var rank domain.LinkRank
		if err := rows.Scan(&rank.ID, &rank.Alias, &rank.DestinationURL, &rank.Title, &rank.RedirectCode, &rank.Status, &rank.Version, &rank.ExpiresAt, &rank.CreatedAt, &rank.UpdatedAt, &rank.LastCheckedAt, &rank.LastStatusCode, &rank.Clicks, &rank.Tags, &rank.Domain); err != nil {
			return nil, err
		}
		links = append(links, rank)
	}
	return links, rows.Err()
}

// ExportLinks returns up to limit matching links without the COUNT(*) that the
// paginated list needs, since the caller wants every row rather than a page.
func (s *Store) ExportLinks(ctx context.Context, filter domain.ListFilter, limit int) ([]domain.LinkRank, error) {
	where, args := buildLinkWhere(filter)
	args = append(args, limit)
	query := fmt.Sprintf(`SELECT %s FROM links l %s %s ORDER BY %s LIMIT $%d`,
		linkSelectColumns, s.linkClickJoin(), where, linkOrder(filter.Sort), len(args))
	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLinkRanks(rows)
}

func (s *Store) ListLinks(ctx context.Context, filter domain.ListFilter) ([]domain.LinkRank, int64, error) {
	where, args := buildLinkWhere(filter)

	var total int64
	if err := s.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM links l `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, filter.Limit, filter.Offset)
	query := fmt.Sprintf(`SELECT %s FROM links l %s %s ORDER BY %s LIMIT $%d OFFSET $%d`,
		linkSelectColumns, s.linkClickJoin(), where, linkOrder(filter.Sort), len(args)-1, len(args))

	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	links, err := scanLinkRanks(rows)
	if err != nil {
		return nil, 0, err
	}
	return links, total, nil
}

// ListTags returns every tag that is still attached to a live link, most used
// first. Tags whose links were all deleted drop out, so the filter list cannot
// accumulate dead entries. Tags themselves are a shared vocabulary; only the
// counts are narrowed to the caller's own links.
func (s *Store) ListTags(ctx context.Context, ownerID *string) ([]domain.TagStat, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT t.name, COUNT(lt.link_id)
		FROM tags t
		JOIN link_tags lt ON lt.tag_id = t.id
		JOIN links l ON l.id = lt.link_id AND l.deleted_at IS NULL AND ($1::uuid IS NULL OR l.user_id = $1)
		GROUP BY t.name
		ORDER BY COUNT(lt.link_id) DESC, t.name ASC`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tags := make([]domain.TagStat, 0)
	for rows.Next() {
		var tag domain.TagStat
		if err := rows.Scan(&tag.Name, &tag.Links); err != nil {
			return nil, err
		}
		tags = append(tags, tag)
	}
	return tags, rows.Err()
}

// TopLinks returns links ordered by clicks within [from, to).
// order is "top" (most clicked) or "bottom" (least clicked); any other value
// means "top". Links with no clicks in the range are excluded.
func (s *Store) TopLinks(ctx context.Context, order string, limit int, from, to time.Time, ownerID *string) ([]domain.LinkRank, error) {
	direction := "DESC"
	if order == "bottom" {
		direction = "ASC"
	}
	query := fmt.Sprintf(`SELECT %s FROM links l
		JOIN (SELECT link_id, SUM(`+s.clickCount("clicks", "bot_clicks")+`) AS clicks FROM link_click_daily
			WHERE day >= $2::date AND day < $3::date GROUP BY link_id) c ON c.link_id=l.id
		WHERE l.deleted_at IS NULL AND ($4::uuid IS NULL OR l.user_id = $4)
		ORDER BY c.clicks %s, l.created_at DESC
		LIMIT $1`, linkSelectColumns, direction)
	rows, err := s.Pool.Query(ctx, query, limit, from, to, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLinkRanks(rows)
}

// UpdateLink writes the mutable link fields. tags is nil to leave the tag set
// untouched, or a (possibly empty) slice to replace it; rules follows the same
// convention. ownerID nil means no restriction, so an administrator can edit any
// link.
func (s *Store) UpdateLink(ctx context.Context, link domain.Link, tags *[]string, rules *[]domain.LinkRule, ownerID *string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	result, err := tx.Exec(ctx, `UPDATE links SET destination_url=$1, title=$2, redirect_code=$3, status=$4, expires_at=$5, domain=NULLIF($6,''), version=version+1, updated_at=now() WHERE id=$7 AND deleted_at IS NULL AND ($8::uuid IS NULL OR user_id=$8)`,
		link.DestinationURL, link.Title, link.RedirectCode, link.Status, link.ExpiresAt, link.Domain, link.ID, ownerID)
	if err != nil {
		return normalizeDBError(err)
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	if tags != nil {
		if err := setLinkTags(ctx, tx, link.ID, *tags); err != nil {
			return err
		}
	}
	if rules != nil {
		if err := setLinkRules(ctx, tx, link.ID, *rules); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) DeleteLink(ctx context.Context, id string, ownerID *string) error {
	result, err := s.Pool.Exec(ctx, `UPDATE links SET status='deleted', deleted_at=now(), version=version+1, updated_at=now() WHERE id=$1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR user_id=$2)`, id, ownerID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// bulkLinkUpdate applies one UPDATE to the caller's links and returns the
// aliases it touched, which is what the redirect cache needs to evict.
//
// set is a literal from this file, never caller input; any values it
// references are bound as $3 onwards through extra. Ids the caller does not own
// are simply not matched, so a batch reports "how many of mine changed" rather
// than failing on the first foreign id.
func (s *Store) bulkLinkUpdate(ctx context.Context, ids []string, ownerID *string, set string, extra ...any) ([]string, error) {
	args := append([]any{ids, ownerID}, extra...)
	query := fmt.Sprintf(`UPDATE links SET %s, version=version+1, updated_at=now()
		WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL AND ($2::uuid IS NULL OR user_id=$2)
		RETURNING alias`, set)
	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	aliases := make([]string, 0, len(ids))
	for rows.Next() {
		var alias string
		if err := rows.Scan(&alias); err != nil {
			return nil, err
		}
		aliases = append(aliases, alias)
	}
	return aliases, rows.Err()
}

// BulkDeleteLinks soft-deletes the caller's links.
func (s *Store) BulkDeleteLinks(ctx context.Context, ids []string, ownerID *string) ([]string, error) {
	return s.bulkLinkUpdate(ctx, ids, ownerID, "status='deleted', deleted_at=now()")
}

// BulkSetStatus enables or disables the caller's links. status is bound as a
// parameter and must be 'active' or 'disabled'.
func (s *Store) BulkSetStatus(ctx context.Context, ids []string, ownerID *string, status string) ([]string, error) {
	return s.bulkLinkUpdate(ctx, ids, ownerID, "status=$3", status)
}

// BulkSetExpiry sets or clears the expiry on the caller's links. A nil expiry
// removes it, which is what makes a link permanent again.
func (s *Store) BulkSetExpiry(ctx context.Context, ids []string, ownerID *string, expiresAt *time.Time) ([]string, error) {
	return s.bulkLinkUpdate(ctx, ids, ownerID, "expires_at=$3", expiresAt)
}

// BulkTagLinks adds or removes tags on the caller's links and reports how many
// links were touched.
//
// The cache is deliberately left alone: a cached link is only ever read to
// decide a redirect, and tags play no part in that.
func (s *Store) BulkTagLinks(ctx context.Context, ids []string, ownerID *string, tags []string, add bool) (int64, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if !add {
		result, err := tx.Exec(ctx, `DELETE FROM link_tags lt USING links l
			WHERE lt.link_id = l.id AND lt.link_id = ANY($1::uuid[]) AND l.deleted_at IS NULL
				AND ($2::uuid IS NULL OR l.user_id = $2)
				AND lt.tag_id IN (SELECT id FROM tags WHERE name = ANY($3::text[]))`, ids, ownerID, tags)
		if err != nil {
			return 0, err
		}
		return result.RowsAffected(), tx.Commit(ctx)
	}

	// Tags are a shared vocabulary, so an existing name is reused rather than
	// duplicated; the join rows then come from one INSERT ... SELECT.
	if _, err := tx.Exec(ctx, `INSERT INTO tags (name) SELECT unnest($1::text[]) ON CONFLICT (name) DO NOTHING`, tags); err != nil {
		return 0, err
	}
	result, err := tx.Exec(ctx, `INSERT INTO link_tags (link_id, tag_id)
		SELECT l.id, t.id FROM links l JOIN tags t ON t.name = ANY($3::text[])
		WHERE l.id = ANY($1::uuid[]) AND l.deleted_at IS NULL AND ($2::uuid IS NULL OR l.user_id = $2)
		ON CONFLICT DO NOTHING`, ids, ownerID, tags)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), tx.Commit(ctx)
}

// CountLinksByOwner counts the live links one account owns. Soft-deleted links
// are excluded, so deleting frees a slot against the per-account cap.
func (s *Store) CountLinksByOwner(ctx context.Context, ownerID string) (int64, error) {
	var total int64
	err := s.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM links WHERE user_id=$1 AND deleted_at IS NULL`, ownerID).Scan(&total)
	return total, err
}

// PruneExpiredLinks hard-deletes links whose expiry passed more than grace ago
// and reports how many went. Click events, daily rollups and tag links are
// removed with them by ON DELETE CASCADE, so this cannot be undone.
//
// The grace period is bound in seconds and turned into an interval by the
// database: Go's duration strings ("720h0m0s") are not interval literals.
func (s *Store) PruneExpiredLinks(ctx context.Context, grace time.Duration, limit int) (int64, error) {
	result, err := s.Pool.Exec(ctx, `
		DELETE FROM links WHERE id IN (
			SELECT id FROM links
			WHERE expires_at IS NOT NULL AND expires_at < now() - make_interval(secs => $1)
			ORDER BY expires_at ASC
			LIMIT $2
		)`, grace.Seconds(), limit)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}

// LinksDueForCheck returns active links whose last probe is missing or older
// than staleBefore, least recently checked first.
func (s *Store) LinksDueForCheck(ctx context.Context, staleBefore time.Time, limit int) ([]domain.LinkTarget, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, alias, destination_url FROM links
		WHERE deleted_at IS NULL AND status='active'
			AND (last_checked_at IS NULL OR last_checked_at < $1)
		ORDER BY last_checked_at ASC NULLS FIRST
		LIMIT $2`, staleBefore, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	targets := make([]domain.LinkTarget, 0)
	for rows.Next() {
		var target domain.LinkTarget
		if err := rows.Scan(&target.ID, &target.Alias, &target.DestinationURL); err != nil {
			return nil, err
		}
		targets = append(targets, target)
	}
	return targets, rows.Err()
}

// RecordLinkHealth stores the outcome of one probe. A status code of 0 records
// a destination that could not be reached.
//
// This is metadata about a probe rather than an edit, so it leaves updated_at
// and version alone: "last edited" would otherwise mean "last checked".
func (s *Store) RecordLinkHealth(ctx context.Context, linkID string, checkedAt time.Time, statusCode int) error {
	result, err := s.Pool.Exec(ctx, `UPDATE links SET last_checked_at=$2, last_status_code=$3 WHERE id=$1`, linkID, checkedAt, statusCode)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// CreateClickEvent records one click. isBot is decided by the caller so the
// store stays free of user-agent parsing.
func (s *Store) CreateClickEvent(ctx context.Context, linkID string, ipHash []byte, userAgent, referrer string, isBot bool) error {
	_, err := s.Pool.Exec(ctx, `INSERT INTO click_events (link_id, ip_hash, user_agent, referrer, is_bot) VALUES ($1,$2,$3,$4,$5)`, linkID, ipHash, truncate(userAgent, 512), truncate(referrer, 2048), isBot)
	return err
}

// Summary counts live links and their clicks. Deleted links are excluded so the
// headline totals always agree with the link list and the rankings.
func (s *Store) Summary(ctx context.Context, ownerID *string) (domain.StatsSummary, error) {
	var summary domain.StatsSummary
	err := s.Pool.QueryRow(ctx, `SELECT COUNT(*), COALESCE((SELECT SUM(`+s.clickCount("d.clicks", "d.bot_clicks")+`) FROM link_click_daily d JOIN links l ON l.id=d.link_id WHERE l.deleted_at IS NULL AND ($1::uuid IS NULL OR l.user_id=$1)),0) FROM links WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR user_id=$1)`, ownerID).Scan(&summary.TotalLinks, &summary.TotalClicks)
	return summary, err
}

// DailyStats returns per-day clicks for one link within [from, to).
func (s *Store) DailyStats(ctx context.Context, linkID string, from, to time.Time) ([]domain.DailyStat, error) {
	rows, err := s.Pool.Query(ctx, `SELECT day, `+s.clickCount("clicks", "bot_clicks")+` FROM link_click_daily WHERE link_id=$1 AND day >= $2::date AND day < $3::date ORDER BY day`, linkID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	stats := make([]domain.DailyStat, 0)
	for rows.Next() {
		var stat domain.DailyStat
		if err := rows.Scan(&stat.Day, &stat.Clicks); err != nil {
			return nil, err
		}
		stats = append(stats, stat)
	}
	return stats, rows.Err()
}

func (s *Store) LinkTotalClicks(ctx context.Context, linkID string) (int64, error) {
	var total int64
	err := s.Pool.QueryRow(ctx, `SELECT COALESCE(SUM(`+s.clickCount("clicks", "bot_clicks")+`),0) FROM link_click_daily WHERE link_id=$1`, linkID).Scan(&total)
	return total, err
}

// LinkReferrers aggregates the raw click events for a link by referrer.
// An empty referrer string represents direct traffic.
func (s *Store) LinkReferrers(ctx context.Context, linkID string, from, to time.Time, limit int) ([]domain.ReferrerStat, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT referrer, COUNT(*) AS clicks
		FROM click_events
		WHERE link_id=$1 AND occurred_at >= $2 AND occurred_at < $3`+s.notBot("is_bot")+`
		GROUP BY referrer
		ORDER BY clicks DESC, referrer ASC
		LIMIT $4`, linkID, from, to, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	stats := make([]domain.ReferrerStat, 0)
	for rows.Next() {
		var stat domain.ReferrerStat
		var referrer *string
		if err := rows.Scan(&referrer, &stat.Clicks); err != nil {
			return nil, err
		}
		if referrer != nil {
			stat.Referrer = *referrer
		}
		stats = append(stats, stat)
	}
	return stats, rows.Err()
}

// GlobalTrend returns total clicks per day across all links within [from, to).
// Days without traffic come back as zero so callers do not have to fill gaps.
func (s *Store) GlobalTrend(ctx context.Context, from, to time.Time, ownerID *string) ([]domain.TrendPoint, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT d.day, SUM(`+s.clickCount("d.clicks", "d.bot_clicks")+`)
		FROM link_click_daily d
		JOIN links l ON l.id = d.link_id
		WHERE l.deleted_at IS NULL AND d.day >= $1::date AND d.day < $2::date
			AND ($3::uuid IS NULL OR l.user_id = $3)
		GROUP BY d.day`, from, to, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byDay := map[string]int64{}
	for rows.Next() {
		var day time.Time
		var clicks int64
		if err := rows.Scan(&day, &clicks); err != nil {
			return nil, err
		}
		byDay[day.Format("2006-01-02")] = clicks
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	points := make([]domain.TrendPoint, 0)
	for day := from; day.Before(to); day = day.AddDate(0, 0, 1) {
		points = append(points, domain.TrendPoint{Day: day, Clicks: byDay[day.Format("2006-01-02")]})
	}
	return points, nil
}

// UniqueVisitors counts distinct visitor hashes within [from, to).
// It reads the raw event table because the daily rollup has no visitor column.
func (s *Store) UniqueVisitors(ctx context.Context, from, to time.Time, ownerID *string) (int64, error) {
	var total int64
	err := s.Pool.QueryRow(ctx, `SELECT COUNT(DISTINCT e.ip_hash) FROM click_events e JOIN links l ON l.id=e.link_id WHERE l.deleted_at IS NULL AND ($3::uuid IS NULL OR l.user_id=$3) AND e.occurred_at >= $1 AND e.occurred_at < $2`+s.notBot("e.is_bot"), from, to, ownerID).Scan(&total)
	return total, err
}

// GlobalReferrers aggregates every click event in the range by referrer.
func (s *Store) GlobalReferrers(ctx context.Context, from, to time.Time, limit int, ownerID *string) ([]domain.ReferrerStat, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT e.referrer, COUNT(*) AS clicks
		FROM click_events e
		JOIN links l ON l.id = e.link_id
		WHERE l.deleted_at IS NULL AND e.occurred_at >= $1 AND e.occurred_at < $2
			AND ($4::uuid IS NULL OR l.user_id = $4)`+s.notBot("e.is_bot")+`
		GROUP BY e.referrer
		ORDER BY clicks DESC, e.referrer ASC
		LIMIT $3`, from, to, limit, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	stats := make([]domain.ReferrerStat, 0)
	for rows.Next() {
		var stat domain.ReferrerStat
		var referrer *string
		if err := rows.Scan(&referrer, &stat.Clicks); err != nil {
			return nil, err
		}
		if referrer != nil {
			stat.Referrer = *referrer
		}
		stats = append(stats, stat)
	}
	return stats, rows.Err()
}

// DeviceBreakdown buckets clicks by a coarse classification of the user agent.
// Bots are read from the flag stamped at ingestion rather than re-matching the
// user agent, so the breakdown agrees with the totals; when bot traffic is not
// being counted they drop out of this chart entirely.
func (s *Store) DeviceBreakdown(ctx context.Context, from, to time.Time, ownerID *string) ([]domain.DeviceStat, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT CASE
			WHEN e.user_agent IS NULL OR e.user_agent = '' THEN 'unknown'
			WHEN e.is_bot THEN 'bot'
			WHEN e.user_agent ILIKE '%ipad%' OR e.user_agent ILIKE '%tablet%' THEN 'tablet'
			WHEN e.user_agent ILIKE '%mobile%' OR e.user_agent ILIKE '%android%' OR e.user_agent ILIKE '%iphone%'
				OR e.user_agent ILIKE '%ipod%' THEN 'mobile'
			ELSE 'desktop'
		END AS device, COUNT(*) AS clicks
		FROM click_events e
		JOIN links l ON l.id = e.link_id
		WHERE l.deleted_at IS NULL AND e.occurred_at >= $1 AND e.occurred_at < $2
			AND ($3::uuid IS NULL OR l.user_id = $3)`+s.notBot("e.is_bot")+`
		GROUP BY device
		ORDER BY clicks DESC`, from, to, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	stats := make([]domain.DeviceStat, 0)
	for rows.Next() {
		var stat domain.DeviceStat
		if err := rows.Scan(&stat.Device, &stat.Clicks); err != nil {
			return nil, err
		}
		stats = append(stats, stat)
	}
	return stats, rows.Err()
}

// LinkClicks returns the raw click events for one link, newest first.
func (s *Store) LinkClicks(ctx context.Context, linkID string, from, to time.Time, limit, offset int) ([]domain.RecentClick, int64, error) {
	var total int64
	if err := s.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM click_events e
		JOIN links l ON l.id = e.link_id
		WHERE l.deleted_at IS NULL AND e.link_id=$1 AND e.occurred_at >= $2 AND e.occurred_at < $3`+s.notBot("e.is_bot"),
		linkID, from, to).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT e.link_id, l.alias, e.occurred_at, COALESCE(e.referrer, ''), COALESCE(e.user_agent, '')
		FROM click_events e
		JOIN links l ON l.id = e.link_id
		WHERE l.deleted_at IS NULL AND e.link_id=$1 AND e.occurred_at >= $2 AND e.occurred_at < $3`+s.notBot("e.is_bot")+`
		ORDER BY e.occurred_at DESC
		LIMIT $4 OFFSET $5`, linkID, from, to, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	clicks := make([]domain.RecentClick, 0)
	for rows.Next() {
		var click domain.RecentClick
		if err := rows.Scan(&click.LinkID, &click.Alias, &click.OccurredAt, &click.Referrer, &click.UserAgent); err != nil {
			return nil, 0, err
		}
		clicks = append(clicks, click)
	}
	return clicks, total, rows.Err()
}

// RecentClicks returns the newest raw click events in the range.
func (s *Store) RecentClicks(ctx context.Context, from, to time.Time, limit int, ownerID *string) ([]domain.RecentClick, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT e.link_id, l.alias, e.occurred_at, COALESCE(e.referrer, ''), COALESCE(e.user_agent, '')
		FROM click_events e
		JOIN links l ON l.id = e.link_id
		WHERE l.deleted_at IS NULL AND e.occurred_at >= $1 AND e.occurred_at < $2
			AND ($4::uuid IS NULL OR l.user_id = $4)`+s.notBot("e.is_bot")+`
		ORDER BY e.occurred_at DESC
		LIMIT $3`, from, to, limit, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	clicks := make([]domain.RecentClick, 0)
	for rows.Next() {
		var click domain.RecentClick
		if err := rows.Scan(&click.LinkID, &click.Alias, &click.OccurredAt, &click.Referrer, &click.UserAgent); err != nil {
			return nil, err
		}
		clicks = append(clicks, click)
	}
	return clicks, rows.Err()
}

func (s *Store) CreateToken(ctx context.Context, tokenID, userID, name string, tokenHash []byte, prefix string, scopes []string) error {
	_, err := s.Pool.Exec(ctx, `INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes) VALUES ($1,$2,$3,$4,$5,$6)`, tokenID, userID, name, tokenHash, prefix, scopes)
	return normalizeDBError(err)
}

func (s *Store) ListTokens(ctx context.Context, userID string) ([]domain.Token, error) {
	rows, err := s.Pool.Query(ctx, `SELECT id, name, token_prefix, scopes, last_used_at, revoked_at, created_at FROM api_tokens WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]domain.Token, 0)
	for rows.Next() {
		var token domain.Token
		var scopes []byte
		if err := rows.Scan(&token.ID, &token.Name, &token.Prefix, &scopes, &token.LastUsedAt, &token.RevokedAt, &token.CreatedAt); err != nil {
			return nil, err
		}
		token.Scopes = parseScopes(scopes)
		result = append(result, token)
	}
	return result, rows.Err()
}

func (s *Store) RevokeToken(ctx context.Context, userID, tokenID string) error {
	result, err := s.Pool.Exec(ctx, `UPDATE api_tokens SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`, tokenID, userID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// AuthenticateToken resolves a bearer token to its owner, the scopes granted to
// that token, and the owner's visibility.
//
// The role join is not decoration: the owner's Unrestricted flag is what decides
// whose links the token can see, and an administrator's token that came back
// restricted would silently see only its owner's links. The token's own scopes
// still come from api_tokens, not from the role.
func (s *Store) AuthenticateToken(ctx context.Context, tokenHash []byte) (domain.User, []string, bool, error) {
	var user domain.User
	var rawScopes []byte
	err := s.Pool.QueryRow(ctx, `SELECT u.id, u.username, u.role, t.scopes, r.unrestricted
		FROM api_tokens t
		JOIN admin_users u ON u.id=t.user_id
		JOIN roles r ON r.name=u.role
		WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND u.disabled=false`, tokenHash).
		Scan(&user.ID, &user.Username, &user.Role, &rawScopes, &user.Unrestricted)
	if errors.Is(err, pgx.ErrNoRows) {
		return user, nil, false, nil
	}
	if err != nil {
		return user, nil, false, err
	}
	// The user object reports the credential's effective scopes, so /auth/me
	// describes what the caller can actually do: for a bearer token that is the
	// token's own set, not the account's.
	user.Scopes = parseScopes(rawScopes)
	_, _ = s.Pool.Exec(ctx, `UPDATE api_tokens SET last_used_at=now() WHERE token_hash=$1`, tokenHash)
	return user, user.Scopes, true, nil
}

// parseScopes decodes the scopes jsonb column. A missing, null or malformed
// value yields no scopes, so a corrupt row can never widen a token's access.
func parseScopes(raw []byte) []string {
	scopes := make([]string, 0)
	if len(raw) == 0 {
		return scopes
	}
	if err := json.Unmarshal(raw, &scopes); err != nil || scopes == nil {
		return make([]string, 0)
	}
	return scopes
}

// AggregateClicks rolls pending raw events into the daily table. Both the total
// and the bot subset are maintained on every rollup, so a later change to
// COUNT_BOTS never has to recompute history.
func (s *Store) AggregateClicks(ctx context.Context, batchSize int) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT id, link_id, occurred_at::date, is_bot FROM click_events WHERE processed_at IS NULL ORDER BY occurred_at LIMIT $1 FOR UPDATE SKIP LOCKED`, batchSize)
	if err != nil {
		return err
	}
	var ids []string
	type aggregate struct {
		linkID   string
		day      time.Time
		count    int64
		botCount int64
	}
	counts := map[string]*aggregate{}
	for rows.Next() {
		var id, linkID string
		var day time.Time
		var isBot bool
		if err := rows.Scan(&id, &linkID, &day, &isBot); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
		key := linkID + ":" + day.Format("2006-01-02")
		if counts[key] == nil {
			counts[key] = &aggregate{linkID: linkID, day: day}
		}
		counts[key].count++
		if isBot {
			counts[key].botCount++
		}
	}
	rows.Close()
	for _, item := range counts {
		if _, err := tx.Exec(ctx, `INSERT INTO link_click_daily (link_id, day, clicks, bot_clicks) VALUES ($1,$2,$3,$4) ON CONFLICT (link_id,day) DO UPDATE SET clicks=link_click_daily.clicks+EXCLUDED.clicks, bot_clicks=link_click_daily.bot_clicks+EXCLUDED.bot_clicks`, item.linkID, item.day, item.count, item.botCount); err != nil {
			return err
		}
	}
	if len(ids) > 0 {
		if _, err := tx.Exec(ctx, `UPDATE click_events SET processed_at=now() WHERE id = ANY($1::uuid[])`, ids); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func normalizeDBError(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return ErrConflict
		case "23503":
			// A foreign key violation means a field points at a row that does
			// not exist — in practice a role name. Services validate the role
			// before writing, so this is a backstop for a race; it must still
			// read as a bad request rather than a server fault, and it must not
			// leak the constraint name.
			return errors.New("referenced record does not exist")
		case "22P02":
			// A malformed id in a path parameter. Postgres rejects the cast, and
			// its own text names the column, the offending value and the
			// SQLSTATE, so it must not reach the client.
			//
			// Not found rather than a bad request on purpose: it keeps a
			// malformed id indistinguishable from an id that is well formed but
			// absent, so the endpoint cannot be used to probe which id format a
			// resource uses.
			return ErrNotFound
		}
	}
	return err
}

// IsDBError reports whether err came from the database rather than from this
// application.
//
// It exists for the one place that decides what a client is allowed to read: an
// error that normalizeDBError did not classify still carries Postgres' own text,
// which names columns, constraints and SQLSTATEs. Anything matching this must be
// answered generically rather than echoed.
func IsDBError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr)
}

func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return strings.Clone(value[:max])
}

func NewID() string { return uuid.NewString() }
