SHELL := /bin/sh

.PHONY: dev test fmt build migrate-up compose-up smoke-api smoke-users smoke-lifecycle smoke-totp smoke-oidc smoke-analytics smoke-pages smoke-all

dev:
	go run ./cmd/purels-api

test:
	go test ./...

# API checks against a running stack (default http://localhost:8080).
smoke-api:
	node scripts/smoke-api.mjs

smoke-users:
	node scripts/smoke-users.mjs

smoke-lifecycle:
	node scripts/smoke-lifecycle.mjs

# Runs against the default configuration too, where it asserts that enrolment is
# refused rather than failing; the full run needs deploy/.totp-check.yaml.
smoke-totp:
	node scripts/smoke-totp.mjs

# Picks its own branch by probing whether a client secret can be stored, so the
# default configuration is verified rather than skipped.
smoke-oidc:
	node scripts/smoke-oidc.mjs

# Mostly the refusal cases: these values are interpolated into a script that
# runs on every console page, so what must not be stored is the interesting part.
# What actually gets injected is smoke-pages.mjs's business.
smoke-analytics:
	node scripts/smoke-analytics.mjs

# Browser checks. Requires headless Chrome with the DevTools protocol enabled:
#   chrome --headless=new --disable-gpu --remote-debugging-port=9222 \
#          --user-data-dir=/tmp/purels-chrome about:blank
smoke-pages:
	node scripts/smoke-pages.mjs

# Every suite, one at a time. They share the API rate-limit bucket, so running
# them back to back (or in parallel) makes them fail each other's limits.
smoke-all:
	@for suite in smoke-api smoke-users smoke-lifecycle smoke-totp smoke-oidc smoke-analytics smoke-pages; do \
		echo "===================== $$suite ====================="; \
		node scripts/$$suite.mjs || exit 1; \
		[ "$$suite" = smoke-pages ] || sleep 65; \
	done

fmt:
	gofmt -w $$(find . -name '*.go' -not -path './web/*')

build:
	go build ./cmd/purels-api ./cmd/purels-worker

migrate-up:
	migrate -path migrations -database "$${DATABASE_URL}" up

compose-up:
	docker compose -f deploy/compose.yaml up --build
