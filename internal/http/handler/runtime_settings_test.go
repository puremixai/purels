package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/purels/purels/internal/domain"
)

func TestGetRuntimeSettingsUsesEmptyListsInJSON(t *testing.T) {
	h := &Handler{
		Settings: &testRuntimeSettingsManager{
			settings: domain.RuntimeSettings{},
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/settings/runtime", nil)
	res := httptest.NewRecorder()

	h.GetRuntimeSettings(res, req)

	var payload struct {
		Settings struct {
			DestinationDenylist []string `json:"destination_denylist"`
			ShortDomains        []string `json:"short_domains"`
		} `json:"settings"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Settings.DestinationDenylist == nil {
		t.Fatal("destination_denylist must be an empty JSON array, not null")
	}
	if payload.Settings.ShortDomains == nil {
		t.Fatal("short_domains must be an empty JSON array, not null")
	}
}
