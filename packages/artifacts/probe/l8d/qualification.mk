# Standalone lane runner; never reads .env or starts the owner's stack.
SHELL := /bin/bash
ENV ?=
export COMPOSE_PROJECT_NAME := $(ENV)
export COMPOSE_DISABLE_ENV_FILE := 1
COMPOSE := docker compose --env-file /dev/null -p $(ENV) -f docker-compose.immo-861.yml
PROBE := packages/artifacts/probe/l8d
OUT := tmp/l8d
RADAR_REPO ?= /home/antoinefa/src/radar-immobilier

pin-radar: guard
	@mkdir -p $(OUT)/radar
	@git -C "$(RADAR_REPO)" merge-base --is-ancestor f2b6c25cc9458ec285d6d4f620a55dad8c30f909 b2b802b5
	@git -C "$(RADAR_REPO)" merge-base --is-ancestor b104ae90a28a5581e8eabd15f12acb58558d3396 b2b802b5
	@git -C "$(RADAR_REPO)" archive b2b802b5 | tar -x -C $(OUT)/radar
	@for file in artifacts-provider-acceptance.spec.ts artifacts-provider-contract.helpers.ts; do git -C "$(RADAR_REPO)" show e2e9515ea41baebf5539743f0cfa0dea750d072c:api/tests/integration/$$file > $(OUT)/radar/api/tests/integration/$$file; done

.PHONY: guard test pack install radar receipts down scope-check mesh-0192
guard:
	@case "$(ENV)" in test-861-l8d|test-861-pack-l8dfix) ;; *) exit 1 ;; esac

test: guard
	@mkdir -p $(OUT)
	@set -o pipefail; $(COMPOSE) run --rm --no-deps qualification node --test $(PROBE)/receipt.test.mjs $(PROBE)/known-failures.test.mjs $(PROBE)/mesh-0192.mjs 2>&1 | tee $(OUT)/tests.log

pack: guard
	@$(COMPOSE) run --rm --no-deps -u "$$(id -u):$$(id -g)" qualification node $(PROBE)/pack.mjs

install: guard
	@set -o pipefail; $(COMPOSE) run --rm --no-deps -u "$$(id -u):$$(id -g)" qualification node $(PROBE)/install.mjs 2>&1 | tee $(OUT)/install.log

smoke: guard
	@$(COMPOSE) run --rm --no-deps -u "$$(id -u):$$(id -g)" qualification node $(PROBE)/smoke.mjs

known-failures: guard
	@$(COMPOSE) run --rm --no-deps -u "$$(id -u):$$(id -g)" qualification node --test $(PROBE)/known-failures.test.mjs

mesh-0192: guard
	@$(COMPOSE) run --rm --no-deps -u "$$(id -u):$$(id -g)" qualification node --test $(PROBE)/mesh-0192.mjs

radar: guard
	@mkdir -p $(OUT)
	@git rev-parse HEAD > $(OUT)/source-commit
	@if grep -q '"status": "passed"' $(OUT)/install.json; then $(COMPOSE) up -d --wait postgres minio; fi
	@$(COMPOSE) run --rm --no-deps -u "$$(id -u):$$(id -g)" qualification node $(PROBE)/radar.mjs

receipts: guard
	@$(COMPOSE) run --rm --no-deps qualification node $(PROBE)/receipt.mjs $(OUT)/receipt.json

scope-check: guard
	@files="$$( { git diff --cached --name-only; git diff --name-only; } | sort -u | paste -sd, - )"; harness check scope --branch-md "$(CURDIR)/BRANCH.md" --staged-files "$$files"

down: guard
	@$(COMPOSE) down --volumes --remove-orphans
