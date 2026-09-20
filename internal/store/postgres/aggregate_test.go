package postgres

import (
	"errors"
	"testing"
)

type errorClickRows struct {
	err error
}

func (r *errorClickRows) Close()            {}
func (r *errorClickRows) Err() error        { return r.err }
func (r *errorClickRows) Next() bool        { return false }
func (r *errorClickRows) Scan(...any) error { return nil }

func TestScanClickAggregatesReturnsRowsError(t *testing.T) {
	want := errors.New("connection lost while reading click events")

	_, _, err := scanClickAggregates(&errorClickRows{err: want})
	if !errors.Is(err, want) {
		t.Fatalf("scanClickAggregates() error = %v, want %v", err, want)
	}
}

func TestCountBotsProviderOverridesStaticFlag(t *testing.T) {
	countBots := false
	store := &Store{CountBots: true, CountBotsProvider: func() bool { return countBots }}

	if got := store.clickCount("clicks", "bot_clicks"); got != "clicks - bot_clicks" {
		t.Fatalf("clickCount() = %q, want bot clicks hidden", got)
	}
	if got := store.notBot("is_bot"); got != " AND NOT is_bot" {
		t.Fatalf("notBot() = %q, want bot predicate", got)
	}

	countBots = true
	if got := store.clickCount("clicks", "bot_clicks"); got != "clicks" {
		t.Fatalf("clickCount() = %q, want bot clicks included", got)
	}
	if got := store.notBot("is_bot"); got != "" {
		t.Fatalf("notBot() = %q, want no bot predicate", got)
	}
}
