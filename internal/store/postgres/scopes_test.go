package postgres

import "testing"

func TestParseScopes(t *testing.T) {
	scopes := parseScopes([]byte(`["links:read","stats:read"]`))
	if len(scopes) != 2 || scopes[0] != "links:read" || scopes[1] != "stats:read" {
		t.Fatalf("unexpected scopes: %#v", scopes)
	}
}

func TestParseScopesDefaultsToNoAccess(t *testing.T) {
	cases := map[string][]byte{
		"nil":     nil,
		"empty":   {},
		"null":    []byte(`null`),
		"object":  []byte(`{"links:read":true}`),
		"garbage": []byte(`not json`),
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			scopes := parseScopes(raw)
			if len(scopes) != 0 {
				t.Fatalf("expected no scopes, got %#v", scopes)
			}
		})
	}
}
