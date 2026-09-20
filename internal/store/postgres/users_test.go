package postgres

import (
	"testing"
	"time"

	"github.com/purels/purels/internal/domain"
)

type accountRow struct{}

func (accountRow) Scan(dest ...any) error {
	*dest[0].(*string) = "user-id"
	*dest[1].(*string) = "alice"
	*dest[2].(*string) = domain.RoleUser
	*dest[3].(*bool) = false
	*dest[4].(*bool) = true
	*dest[5].(*time.Time) = time.Date(2026, time.September, 20, 0, 0, 0, 0, time.UTC)
	*dest[6].(*string) = "oidc"
	*dest[7].(*string) = "Linux.do"
	return nil
}

func TestScanAccountIncludesAuthenticationSource(t *testing.T) {
	account, err := scanAccount(accountRow{})
	if err != nil {
		t.Fatalf("scanAccount returned an error: %v", err)
	}
	if account.AuthSource != "oidc" {
		t.Fatalf("expected OIDC source, got %q", account.AuthSource)
	}
	if account.AuthProvider != "Linux.do" {
		t.Fatalf("expected provider name, got %q", account.AuthProvider)
	}
}
