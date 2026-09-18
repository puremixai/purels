package domain

import "context"

// API token scopes. Interactive (cookie) sessions hold every scope; API tokens
// hold only the scopes stored alongside them.
const (
	ScopeLinksRead    = "links:read"
	ScopeLinksWrite   = "links:write"
	ScopeStatsRead    = "stats:read"
	ScopeTokensManage = "tokens:manage"
	ScopeAuditRead    = "audit:read"
)

// Account roles. A role describes who the actor is; a scope describes what a
// credential is allowed to do. Both are checked: an API token can only ever
// carry the scopes it was minted with, and a regular user's session never
// carries the administrator-only ones.
const (
	RoleAdmin = "admin"
	RoleUser  = "user"
)

// AllScopes is granted to an administrator's interactive session.
var AllScopes = []string{ScopeLinksRead, ScopeLinksWrite, ScopeStatsRead, ScopeTokensManage, ScopeAuditRead}

// UserScopes is granted to a regular user's interactive session. It covers
// managing their own links and their own API tokens, and stops short of the
// audit trail, which is the administrator's view of everybody's activity.
var UserScopes = []string{ScopeLinksRead, ScopeLinksWrite, ScopeStatsRead, ScopeTokensManage}

// DefaultTokenScopes is what a freshly created API token receives. It
// deliberately excludes ScopeTokensManage and ScopeAuditRead so a leaked token
// can neither mint other tokens nor read the audit trail.
var DefaultTokenScopes = []string{ScopeLinksRead, ScopeLinksWrite, ScopeStatsRead}

// ScopesForRole maps an account role to the scopes its interactive session
// holds. An unknown role gets the narrow set rather than the wide one.
func ScopesForRole(role string) []string {
	if role == RoleAdmin {
		return AllScopes
	}
	return UserScopes
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
