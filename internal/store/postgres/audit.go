package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/purels/purels/internal/domain"
)

// CreateAuditLog appends one entry to the audit trail. metadata may be nil.
func (s *Store) CreateAuditLog(ctx context.Context, userID *string, action, resourceType string, resourceID *string, metadata map[string]any, ipHash []byte) error {
	var payload []byte
	if len(metadata) > 0 {
		encoded, err := json.Marshal(metadata)
		if err != nil {
			return err
		}
		payload = encoded
	}
	var resource *string
	if resourceType != "" {
		resource = &resourceType
	}
	_, err := s.Pool.Exec(ctx, `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata, ip_hash)
		VALUES ($1,$2,$3,$4,$5,$6)`, userID, action, resource, resourceID, payload, ipHash)
	return err
}

// ListAuditLogs returns the trail newest first, optionally narrowed to one
// action. The actor's username is joined in for display; once the account is
// deleted user_id becomes NULL and the username renders as empty, but the entry
// itself survives.
func (s *Store) ListAuditLogs(ctx context.Context, action string, limit, offset int) ([]domain.AuditEntry, int64, error) {
	conditions := []string{"1=1"}
	args := []any{}
	if action != "" {
		args = append(args, action)
		conditions = append(conditions, fmt.Sprintf("a.action = $%d", len(args)))
	}
	where := "WHERE " + strings.Join(conditions, " AND ")

	var total int64
	if err := s.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM audit_logs a `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, limit, offset)
	query := fmt.Sprintf(`SELECT a.id, a.user_id, COALESCE(u.username, ''), a.action,
		COALESCE(a.resource_type, ''), a.resource_id, a.metadata, a.created_at
		FROM audit_logs a LEFT JOIN admin_users u ON u.id = a.user_id
		%s ORDER BY a.created_at DESC, a.id DESC LIMIT $%d OFFSET $%d`, where, len(args)-1, len(args))
	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	entries := make([]domain.AuditEntry, 0)
	for rows.Next() {
		var entry domain.AuditEntry
		var metadata []byte
		if err := rows.Scan(&entry.ID, &entry.UserID, &entry.Username, &entry.Action,
			&entry.ResourceType, &entry.ResourceID, &metadata, &entry.CreatedAt); err != nil {
			return nil, 0, err
		}
		if len(metadata) > 0 {
			// A malformed payload must not fail the whole page.
			_ = json.Unmarshal(metadata, &entry.Metadata)
		}
		entries = append(entries, entry)
	}
	return entries, total, rows.Err()
}
