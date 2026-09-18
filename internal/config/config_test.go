package config

import (
	"testing"
	"time"
)

func TestLoadLocation(t *testing.T) {
	location, name := loadLocation("Asia/Shanghai")
	if name != "Asia/Shanghai" || location.String() != "Asia/Shanghai" {
		t.Fatalf("loadLocation returned %q / %v", name, location)
	}
	// 23:30 UTC on the 18th is already the 19th in Shanghai, which is the whole
	// point of the setting: the bucket a click lands in must follow the zone.
	utc := time.Date(2026, 9, 18, 23, 30, 0, 0, time.UTC)
	if got := utc.In(location).Format("2006-01-02"); got != "2026-09-19" {
		t.Fatalf("Shanghai day = %s, want 2026-09-19", got)
	}

	// An unknown or empty zone must degrade to UTC rather than panic or refuse
	// to start: a bad display setting should not take the service down.
	for _, bad := range []string{"", "Not/AZone"} {
		location, name := loadLocation(bad)
		if name != "UTC" || location != time.UTC {
			t.Fatalf("loadLocation(%q) = %q / %v, want UTC", bad, name, location)
		}
	}
}

func TestLocationIsNeverNil(t *testing.T) {
	var empty Config
	if empty.Location() != time.UTC {
		t.Fatal("a zero Config must report UTC, not a nil location")
	}
	if (&Config{StatsLocation: time.FixedZone("X", 3600)}).Location().String() != "X" {
		t.Fatal("Location must return the configured zone")
	}
}
