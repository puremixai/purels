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
