package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/store/postgres"
)

type UserService struct{ Store *postgres.Store }

// List returns every account, for the administrator's user list.
func (u *UserService) List(ctx context.Context) ([]domain.Account, error) {
	return u.Store.ListUsers(ctx)
}

// Update changes an account's role and/or its disabled flag.
//
// Two rules keep the console from locking everybody out: an account cannot
// change itself, so whoever makes a change is still there to undo it, and the
// store refuses any edit that would leave no enabled account able to
// administer users or roles. The role name is validated against the roles
// table rather than a list in code, so an operator-defined role is accepted the
// moment it exists.
func (u *UserService) Update(ctx context.Context, actorID, targetID string, req domain.UpdateUserRequest) error {
	if actorID == targetID {
		return errors.New("cannot change your own account")
	}
	if req.Role == nil && req.Disabled == nil {
		return errors.New("nothing to update")
	}
	if req.Role != nil {
		if _, err := u.Store.GetRole(ctx, *req.Role); err != nil {
			if errors.Is(err, postgres.ErrNotFound) {
				return fmt.Errorf("unknown role: %s", *req.Role)
			}
			return err
		}
	}
	return u.Store.UpdateUser(ctx, targetID, req.Role, req.Disabled)
}
