# Settings redesign — 2026-09-22

Site settings now have five categories: links, registration and sign-in, users
and permissions, traffic protection, and statistics and integrations. Link
settings have separate creation, redirect, and maintenance pages. Personal MFA
and API tokens are accessible from the account menu. Existing URLs redirect or
remain available, and each editor retains its existing permission requirement.

Runtime forms submit changed fields using a revision-checked PATCH. The API
merges against the database snapshot and commits with an atomic revision
predicate. Stale edits receive 409 and remain visible until explicitly discarded.
The old full-document PUT continues to work. Restart/redeploy the API alongside
the web change to enable PATCH on an already-running installation.

## Verification

- `npm run lint`, `npm run typecheck`, `npm run build`: passed.
- `npm run test:settings`: 15 tests passed (navigation, search permissions,
  field partitioning, selective updates, false/zero/empty values and disabled
  dependent controls).
- `go test ./...`: passed. A temporary PostgreSQL instance also verified
  concurrent compare-and-swap writers and compatibility with legacy PUT.
- `scripts/settings-redesign.e2e.mjs`: 31 browser checks passed. All API
  requests were intercepted; no live settings or user data were changed.
- Eight settings/account pages checked at 360, 768, 1280 and 1440px, in English
  and Chinese: no horizontal overflow. Light/dark themes and reduced motion
  checked. Keyboard tests cover Tab/Space, dialog Escape, and mobile menu focus.
- Browser cases cover loading, empty tokens, permission filtering, network/load
  errors, successful saves, 409 conflicts, disabled controls, multiline hosts,
  language switching with drafts, and multiple independently dirty forms.
- Local evidence: `coverage/settings-redesign/report-all.json` and 32 screenshots
  in that directory. The directory is gitignored; rerun the script to regenerate.

Run the browser suite against a local web server with Playwright available:

```powershell
$env:PLAYWRIGHT_MODULE = '<path to installed playwright package>'
$env:BASE_URL = 'http://localhost:3000'
node scripts/settings-redesign.e2e.mjs
```

## UI review

Scope: the changed settings, navigation, and personal account screens. This is
a local implementation review, not a whole-product accessibility certification.

| Area | Score | Evidence |
| --- | ---: | --- |
| Structure and space | 24/25 | Five categories, three link tabs, readable mobile stacking |
| Token consistency | 20/20 | Existing color, surface, radius, and component tokens; no new UI dependency |
| States | 19/20 | Loading, error, permission, save, conflict, disabled, and empty cases covered |
| Interaction and accessibility | 17/20 | Keyboard/dialog/menu checks passed; see navigation limitation below |
| Responsive and bilingual | 10/10 | Eight pages, two languages, four viewport widths |
| Performance and motion | 5/5 | No new runtime dependency; reduced-motion checks passed |
| Total | 95/100 | No P0 issue observed in the covered scenarios |

Unsaved-change confirmation covers in-app anchor navigation, refresh, and tab
close. Browser history back and programmatic router navigation are not intercepted.
The existing broad smoke script was updated for the new settings routes and
token flow and syntax-checked, but was not run against live data; unrelated legacy
`/admin` path assertions in that script still need a separate cleanup.
