package handler

import (
	"context"
	"errors"
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

// recordingRuntimeSettingsManager captures the document a PUT produced. Its
// Update returns an error on purpose: the handler writes an audit record after a
// successful save, and that needs a database this test does not have.
type recordingRuntimeSettingsManager struct {
	testRuntimeSettingsManager
	updates int
	last    domain.RuntimeSettingsInput
}

func (m *recordingRuntimeSettingsManager) Update(_ context.Context, input domain.RuntimeSettingsInput) (domain.RuntimeSettings, error) {
	m.updates++
	m.last = input
	return domain.RuntimeSettings{}, errors.New("stop before the audit write")
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

// A whole-document update has to state the second factor's switch. The field was
// added after this endpoint shipped, and "absent" and "false" are the same thing
// to a struct decode — so a body written before the field existed would switch
// the second factor off without saying so.
func TestUpdateRuntimeSettingsRequiresTheSecondFactorSwitch(t *testing.T) {
	// Every field of the document except totp_enabled, so the only thing each
	// case varies is the switch itself.
	document := `{"alias_mode":"random","unique_urls":true,"registration_enabled":true,` +
		`"count_bots":false,"forward_query":true,"fallback_url":"","auto_prune_expired":false,` +
		`"prune_grace_seconds":0,"max_links_per_user":0,"destination_denylist":[],"short_domains":[],` +
		`"health_check_enabled":false,"health_check_interval_seconds":1,"rate_limit_enabled":false,` +
		`"rate_limit_login":0,"rate_limit_api":0,"rate_limit_redirect":0,"rate_limit_register":0,` +
		`"rate_limit_2fa":0,"rate_limit_oidc":0}`
	withSwitch := func(value string) string {
		return strings.Replace(document, `"count_bots"`, `"totp_enabled":`+value+`,"count_bots"`, 1)
	}
	for _, test := range []struct {
		name    string
		body    string
		status  int
		updates int
		want    bool
	}{
		{"the switch is omitted", document, http.StatusBadRequest, 0, false},
		{"the switch is stated as off", withSwitch("false"), 0, 1, false},
		{"the switch is stated as on", withSwitch("true"), 0, 1, true},
		{"an unknown field is still refused", strings.Replace(withSwitch("false"), `"count_bots"`, `"typo":1,"count_bots"`, 1), http.StatusBadRequest, 0, false},
		{"a malformed body is refused", `{`, http.StatusBadRequest, 0, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			manager := &recordingRuntimeSettingsManager{}
			h := &Handler{Settings: manager}
			r := httptest.NewRequest(http.MethodPut, "/api/v1/settings/runtime", strings.NewReader(test.body))
			w := httptest.NewRecorder()
			h.UpdateRuntimeSettings(w, r)
			if test.status != 0 && w.Code != test.status {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if manager.updates != test.updates {
				t.Fatalf("the document reached the manager %d times, want %d (status=%d body=%s)", manager.updates, test.updates, w.Code, w.Body.String())
			}
			if manager.updates > 0 && manager.last.TOTPEnabled != test.want {
				t.Fatalf("the second factor switch arrived as %v, want %v", manager.last.TOTPEnabled, test.want)
			}
		})
	}
}
