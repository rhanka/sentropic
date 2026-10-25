# Standalone lane runner; never reads .env or starts the owner's stack.
SHELL := /bin/bash
ENV ?=
export COMPOSE_PROJECT_NAME := $(ENV)
export COMPOSE_DISABLE_ENV_FILE := 1
PROBE := packages/artifacts/probe/l8d
COMPOSE := docker compose --env-file /dev/null -p $(ENV) -f docker-compose.immo-861.yml -f $(PROBE)/radar-compose.yml
OUT := tmp/l8d
RADAR_REPO ?= /home/antoinefa/src/radar-immobilier
RADAR_REV ?= dde9f4c85f2ddaef5a394234299a0ab24dfa1343
CANDIDATE_FILE ?= ../861-integration/tmp/final-861/candidate.json

pin-radar: guard
	@mkdir -p $(OUT)/radar
	@git -C "$(RADAR_REPO)" merge-base --is-ancestor 8d6aabb0aea835a45d992d4f379c6fe16d57658c $(RADAR_REV)
	@git -C "$(RADAR_REPO)" archive $(RADAR_REV) | tar -x -C $(OUT)/radar
	@git -C "$(RADAR_REPO)" rev-parse $(RADAR_REV) > $(OUT)/radar-source-commit

.PHONY: guard test pack install radar receipts down scope-check mesh-0192
guard:
	@case "$(ENV)" in test-861-int|test-861-l8d|test-861-pack-l8dfix) ;; *) exit 1 ;; esac

candidate: guard
	@mkdir -p $(OUT)/packs
	@cp "$(CANDIDATE_FILE)" $(OUT)/candidate.json
	@for slug in artifacts cluster-mesh; do cp ../861-integration/tmp/ci-manifest-guard/siblings/cluster-mesh/$$slug/*.tgz $(OUT)/packs/; done
	@$(COMPOSE) run --rm --no-deps -u "$$(id -u):$$(id -g)" qualification node $(PROBE)/pack.mjs

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

summary: guard
	@$(COMPOSE) run --rm --no-deps -u "$$(id -u):$$(id -g)" qualification node $(PROBE)/summary.mjs

.PHONY: aggregate
aggregate: guard
	@$(COMPOSE) run --rm --no-deps qualification node --input-type=module -e 'import {readFileSync} from "node:fs"; import {aggregate} from "./$(PROBE)/receipt.mjs"; console.log(aggregate(JSON.parse(readFileSync("$(OUT)/receipt.json")).shards));'

scope-check: guard
	@files="$$( { git diff --cached --name-only; git diff --name-only; } | sort -u | paste -sd, - )"; harness check scope --branch-md "$(CURDIR)/BRANCH.md" --staged-files "$$files"

down: guard
	@$(COMPOSE) down --volumes --remove-orphans
