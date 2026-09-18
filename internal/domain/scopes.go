package domain

import "context"

// Scopes. A scope is the only unit of authority the router checks: it says what
// a credential may do. Interactive sessions hold the scopes of their role, and
// an API token holds the scopes it was minted with.
const (
	ScopeLinksRead    = "links:read"
	ScopeLinksWrite   = "links:write"
	ScopeStatsRead    = "stats:read"
	ScopeTokensManage = "tokens:manage"
	ScopeAuditRead    = "audit:read"
	ScopeUsersManage  = "users:manage"
	ScopeRolesManage  = "roles:manage"
	// ScopeOIDCManage governs the sign-in methods the console can configure.
	// It is effectively an SSRF capability — the holder chooses an issuer the
	// API will then fetch discovery documents from — so it is granted as
	// sparingly as the other administration scopes.
	ScopeOIDCManage = "oidc:manage"
)

// Role names. These are the four presets the roles table is seeded with. Which
// scopes each one grants is data, not code: the console can adjust it, so a
// role name is a label rather than a permission.
const (
	RoleAdmin    = "admin"
	RoleOperator = "operator"
	RoleReadonly = "readonly"
	RoleUser     = "user"
)

// AllScopes is the complete vocabulary. A role edit is validated against it, so
// a typo cannot be stored as a scope that silently never matches.
var AllScopes = []string{ScopeLinksRead, ScopeLinksWrite, ScopeStatsRead, ScopeTokensManage, ScopeAuditRead, ScopeUsersManage, ScopeRolesManage, ScopeOIDCManage}

// DefaultTokenScopes is what a freshly created API token receives. It is an
// explicit list, and deliberately excludes ScopeTokensManage, ScopeAuditRead,
// ScopeUsersManage, ScopeRolesManage and ScopeOIDCManage: a leaked token must
// not be able to mint other tokens, read the audit trail, administer accounts or
// repoint the sign-in providers.
var DefaultTokenScopes = []string{ScopeLinksRead, ScopeLinksWrite, ScopeStatsRead}

// IsKnownScope reports whether a value is one of the scopes this build knows
// about. Role edits are checked against it so a misspelling is an error rather
// than a stored string that never grants anything.
func IsKnownScope(scope string) bool {
	for _, known := range AllScopes {
		if scope == known {
			return true
		}
	}
	return false
}

const scopesContextKey contextKey = "purels-scopes"

func WithScopes(ctx context.Context, scopes []string) context.Context {
	return context.WithValue(ctx, scopesContextKey, scopes)
}

func ScopesFromContext(ctx context.Context) []string {
	scopes, _ := ctx.Value(scopesContextKey).([]string)
	return scopes
}

func HasScope(ctx context.Context, scope string) bool {
	for _, candidate := range ScopesFromContext(ctx) {
		if candidate == scope {
			return true
		}
	}
	return false
}
