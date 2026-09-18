package domain

import "context"

type contextKey string

const UserContextKey contextKey = "purels-user"
const SessionContextKey contextKey = "purels-session"
const ClientIPContextKey contextKey = "purels-client-ip"

func WithUser(ctx context.Context, user User) context.Context {
	return context.WithValue(ctx, UserContextKey, user)
}
func UserFromContext(ctx context.Context) (User, bool) {
	value, ok := ctx.Value(UserContextKey).(User)
	return value, ok
}
func WithSession(ctx context.Context, session Session) context.Context {
	return context.WithValue(ctx, SessionContextKey, session)
}
func SessionFromContext(ctx context.Context) (Session, bool) {
	value, ok := ctx.Value(SessionContextKey).(Session)
	return value, ok
}

// WithClientIP carries the resolved client address so the service layer can
// record who performed a mutation without the handler passing it down.
func WithClientIP(ctx context.Context, ip string) context.Context {
	return context.WithValue(ctx, ClientIPContextKey, ip)
}
func ClientIPFromContext(ctx context.Context) (string, bool) {
	value, ok := ctx.Value(ClientIPContextKey).(string)
	return value, ok
}

// OwnerIDFromContext is the visibility scope for link reads and writes: nil for
// an administrator, who is not restricted, and the actor's own id for everyone
// else. Services read it here so no handler has to pass it down, which keeps
// every existing call site unchanged.
func OwnerIDFromContext(ctx context.Context) *string {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" || user.IsAdmin() {
		return nil
	}
	id := user.ID
	return &id
}

// ActorIDFromContext is the raw actor id, used to stamp ownership and to match
// an existing link when de-duplicating a destination. De-duplication always
// matches the exact actor, so an administrator re-shortening a URL someone else
// already shortened gets a code of their own instead of being handed a link
// they do not own.
func ActorIDFromContext(ctx context.Context) (string, bool) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return "", false
	}
	return user.ID, true
}
