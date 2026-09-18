package service

import (
	"context"
	"fmt"
	"sort"

	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/store/postgres"
)

type RoleService struct{ Store *postgres.Store }

// List returns every role with the permissions it grants.
func (r *RoleService) List(ctx context.Context) ([]domain.Role, error) {
	return r.Store.ListRoles(ctx)
}

// Update replaces a role's permissions and visibility flag.
func (r *RoleService) Update(ctx context.Context, name string, req domain.UpdateRoleRequest) error {
	scopes, err := normalizeRoleScopes(req.Scopes)
	if err != nil {
		return err
	}
	return r.Store.UpdateRoleScopes(ctx, domain.Role{Name: name, Scopes: scopes, Unrestricted: req.Unrestricted})
}

// normalizeRoleScopes validates a submitted permission set and returns it in a
// canonical form.
//
// The set is checked against the known vocabulary so a typo cannot be stored:
// an unknown scope would never match a route, silently granting less than the
// operator asked for. Duplicates are dropped and the result is sorted so the
// stored value is stable and comparable between reads.
func normalizeRoleScopes(scopes []string) ([]string, error) {
	normalized := make([]string, 0, len(scopes))
	seen := make(map[string]bool, len(scopes))
	for _, scope := range scopes {
		if !domain.IsKnownScope(scope) {
			return nil, fmt.Errorf("unknown scope: %s", scope)
		}
		if seen[scope] {
			continue
		}
		seen[scope] = true
		normalized = append(normalized, scope)
	}
	sort.Strings(normalized)
	return normalized, nil
}
