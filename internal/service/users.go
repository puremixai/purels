package service

import (
	"context"
	"errors"

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
// Two rules keep an administrator from locking everybody out of the console:
// an administrator cannot act on their own account, and the last enabled
// administrator cannot be demoted or disabled. The second rule is checked
// against the other accounts, so it holds even if the first rule were relaxed.
func (u *UserService) Update(ctx context.Context, actorID, targetID string, req domain.UpdateUserRequest) error {
	if actorID == targetID {
		return errors.New("cannot change your own account")
	}
	if req.Role == nil && req.Disabled == nil {
		return errors.New("nothing to update")
	}
	if req.Role != nil && *req.Role != domain.RoleAdmin && *req.Role != domain.RoleUser {
		return errors.New("role must be admin or user")
	}
	losingAdmin := (req.Role != nil && *req.Role != domain.RoleAdmin) || (req.Disabled != nil && *req.Disabled)
	if losingAdmin {
		remaining, err := u.Store.CountEnabledAdmins(ctx, targetID)
		if err != nil {
			return err
		}
		if remaining == 0 {
			return errors.New("at least one enabled administrator must remain")
		}
	}
	return u.Store.UpdateUser(ctx, targetID, req.Role, req.Disabled)
}
