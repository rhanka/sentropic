SHELL := /bin/bash
ENV ?=
export COMPOSE_DISABLE_ENV_FILE := 1
COMPOSE := docker compose --env-file /dev/null -p $(ENV) -f docker-compose.immo-861.yml
OFFLINE_TOOLS ?= /home/antoinefa/src/sentropic/tmp/worktrees/861-integration/node_modules
OFFLINE_LINT_TOOLS ?= /home/antoinefa/src/sentropic/tmp/worktrees/861-L8d/tmp/l8d/radar/node_modules
OFFLINE_MOUNTS = -v "$(OFFLINE_TOOLS):/offline-tools:ro" -v "$(OFFLINE_LINT_TOOLS):/offline-lint-tools:ro" -v /home/antoinefa/.npm/_cacache:/offline-cache:ro

.PHONY: guard packed-example down
guard:
	@test "$(ENV)" = test-861-gaps

packed-example: guard
	@$(COMPOSE) run --rm --no-deps -u "$$(id -u):$$(id -g)" qualification node --test packages/artifacts/probe/packed-example.test.mjs

down: guard
	@$(COMPOSE) down --volumes --remove-orphans

.PHONY: offline-build offline-unit offline-integration offline-packed offline-lint
offline-build offline-unit offline-packed offline-lint: guard
	@$(COMPOSE) run --rm --no-deps -u "$$(id -u):$$(id -g)" $(OFFLINE_MOUNTS) qualification node packages/artifacts/probe/offline-qualification.mjs $@ "$(SCOPE)"

offline-integration: guard
	@$(COMPOSE) up -d --wait postgres minio
	@$(COMPOSE) run --rm --no-deps -u "$$(id -u):$$(id -g)" $(OFFLINE_MOUNTS) -e DATABASE_URL=postgres://app:app@postgres:5432/app -e ARTIFACTS_S3_ENDPOINT=http://minio:9000 -e ARTIFACTS_S3_REGION=us-east-1 -e ARTIFACTS_S3_ACCESS_KEY_ID=minioadmin -e ARTIFACTS_S3_SECRET_ACCESS_KEY=minioadmin qualification node packages/artifacts/probe/offline-qualification.mjs $@ "$(SCOPE)"
