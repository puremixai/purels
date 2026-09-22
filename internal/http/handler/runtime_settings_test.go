package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/purels/purels/internal/domain"
	"github.com/purels/purels/internal/store/postgres"
)

type conflictingRuntimeSettingsManager struct {
	testRuntimeSettingsManager
	calls int
}

func (m *conflictingRuntimeSettingsManager) Patch(context.Context, domain.RuntimeSettingsPatch) (domain.RuntimeSettings, error) {
	m.calls++
	return domain.RuntimeSettings{}, postgres.ErrConflict
}

func TestPatchRuntimeSettingsRequestValidationAndConflict(t *testing.T) {
	for _, test := range []struct {
		body   string
		status int
		code   string
		calls  int
	}{
		{`{"revision":1,"changes":{"count_bots":true}}`, http.StatusConflict, "conflict", 1},
		{`{"changes":{"count_bots":true}}`, http.StatusBadRequest, "invalid_request", 0},
		{`{"revision":1}`, http.StatusBadRequest, "invalid_request", 0},
		{`{"revision":1,"changes":{}}`, http.StatusBadRequest, "invalid_request", 0},
		{`{"revision":1,"changes":{"count_bots":null}}`, http.StatusBadRequest, "invalid_request", 0},
		{`{"revision":1,"changes":{"unknown":true}}`, http.StatusBadRequest, "invalid_request", 0},
		{`{"revision":1,"changes":{"count_bots":"true"}}`, http.StatusBadRequest, "invalid_request", 0},
		{`{"revision":1,"changes":{"count_bots":true},"extra":true}`, http.StatusBadRequest, "invalid_request", 0},
	} {
		t.Run(test.body, func(t *testing.T) {
			manager := &conflictingRuntimeSettingsManager{}
			h := &Handler{Settings: manager}
			r := httptest.NewRequest(http.MethodPatch, "/api/v1/settings/runtime", strings.NewReader(test.body))
			w := httptest.NewRecorder()
			h.PatchRuntimeSettings(w, r)
			if w.Code != test.status || !strings.Contains(w.Body.String(), `"code":"`+test.code+`"`) || manager.calls != test.calls {
				t.Fatalf("status=%d body=%s calls=%d", w.Code, w.Body.String(), manager.calls)
			}
		})
	}
}
