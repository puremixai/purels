package service

import (
	"context"
	"log/slog"

	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/security"
	"github.com/purels/purels/internal/store/postgres"
)

// Audit actions recorded by the handlers. Kept as constants so the trail stays
// queryable and the UI can label them consistently.
const (
	ActionLinkCreate   = "link.create"
	ActionLinkUpdate   = "link.update"
	ActionLinkDelete   = "link.delete"
	ActionLinkImport   = "link.import"
	ActionLinkBulk     = "link.bulk"
	ActionTokenCreate  = "token.create"
	ActionTokenRevoke  = "token.revoke"
	ActionSessionLogin = "session.login"
	ActionSessionEnd   = "session.logout"
	ActionUserRegister = "user.register"
	ActionUserUpdate   = "user.update"
	ActionRoleUpdate   = "role.update"
	// The second-factor actions. session.2fa is a completed login, so the trail
	// shows how an account got in rather than only that it did.
	ActionSession2FA     = "session.2fa"
	ActionUserMFAEnroll  = "user.2fa_enroll"
	ActionUserMFADisable = "user.2fa_disable"
	ActionUserMFAReset   = "user.2fa_reset"
	// Sign-in method changes. These decide who can get in, so they belong in the
	// trail next to the account and role edits.
	ActionOIDCProviderCreate = "oidc.create"
	ActionOIDCProviderUpdate = "oidc.update"
	ActionOIDCProviderDelete = "oidc.delete"
	// Tracking ids are injected as script into every console page, so who
	// changed them belongs in the trail beside the other configuration edits.
	ActionAnalyticsUpdate = "analytics.update"
)

type AuditService struct {
	Store *postgres.Store
	// Hasher turns the caller's address into the stored digest. Its zero value
	// is the default mode, so an unconfigured service still records one.
	Hasher security.IPHasher
}

// Record appends an audit entry for a mutation that has already succeeded.
// The actor and client address are read from ctx, so callers only supply what
// happened. Failures are logged rather than returned: a broken audit trail must
// not turn a successful operation into an error for the operator.
func (a *AuditService) Record(ctx context.Context, action, resourceType, resourceID string, metadata map[string]any) {
	// The client may have disconnected by the time we write; the record still
	// needs to land.
	writeCtx := context.WithoutCancel(ctx)

	var userID *string
	if user, ok := domain.UserFromContext(writeCtx); ok && user.ID != "" {
		userID = &user.ID
	}
	var resource *string
	if resourceID != "" {
		resource = &resourceID
	}
	var ipHash []byte
	if ip, ok := domain.ClientIPFromContext(writeCtx); ok && ip != "" {
		ipHash = a.Hasher.Hash(ip)
	}
	if err := a.Store.CreateAuditLog(writeCtx, userID, action, resourceType, resource, metadata, ipHash); err != nil {
		slog.Error("could not write audit log", "action", action, "err", err)
	}
}

// List returns a page of the audit trail, newest first.
func (a *AuditService) List(ctx context.Context, action string, limit, offset int) (domain.AuditPage, error) {
	entries, total, err := a.Store.ListAuditLogs(ctx, action, limit, offset)
	if err != nil {
		return domain.AuditPage{}, err
	}
	return domain.AuditPage{Entries: entries, Total: total, Limit: limit, Offset: offset}, nil
}
