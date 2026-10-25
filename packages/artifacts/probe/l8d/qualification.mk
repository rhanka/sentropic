# Standalone lane runner; never reads .env or starts the owner's stack.
SHELL := /bin/bash
ENV ?=
export COMPOSE_PROJECT_NAME := $(ENV)
export COMPOSE_DISABLE_ENV_FILE := 1
COMPOSE := docker compose --env-file /dev/null -p $(ENV) -f docker-compose.immo-861.yml
PROBE := packages/artifacts/probe/l8d
OUT := tmp/l8d

.PHONY: guard test pack install radar receipts down scope-check
guard:
	@test "$(ENV)" = test-861-l8d

test: guard
	@$(COMPOSE) run --rm --no-deps qualification node --test $(PROBE)/receipt.test.mjs

pack: guard
	@$(COMPOSE) run --rm --no-deps -u "$$(id -u):$$(id -g)" qualification node $(PROBE)/pack.mjs

install: guard
	@$(COMPOSE) run --rm --no-deps -u "$$(id -u):$$(id -g)" qualification node $(PROBE)/install.mjs

radar: guard
	@mkdir -p $(OUT)
	@git rev-parse HEAD > $(OUT)/source-commit
	@$(COMPOSE) up -d --wait postgres minio
	@$(COMPOSE) run --rm --no-deps -u "$$(id -u):$$(id -g)" qualification node $(PROBE)/radar.mjs

receipts: guard
	@$(COMPOSE) run --rm --no-deps qualification node $(PROBE)/receipt.mjs $(OUT)/receipt.json

scope-check: guard
	@files="$$( { git diff --cached --name-only; git diff --name-only; } | sort -u | paste -sd, - )"; harness check scope --branch-md "$(CURDIR)/BRANCH.md" --staged-files "$$files"

down: guard
	@$(COMPOSE) down --volumes --remove-orphans
