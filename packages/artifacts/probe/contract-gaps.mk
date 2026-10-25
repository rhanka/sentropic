SHELL := /bin/bash
ENV ?=
export COMPOSE_DISABLE_ENV_FILE := 1
COMPOSE := docker compose --env-file /dev/null -p $(ENV) -f docker-compose.immo-861.yml

.PHONY: guard packed-example down
guard:
	@test "$(ENV)" = test-861-gaps

packed-example: guard
	@$(COMPOSE) run --rm --no-deps -u "$$(id -u):$$(id -g)" qualification node --test packages/artifacts/probe/packed-example.test.mjs

down: guard
	@$(COMPOSE) down --volumes --remove-orphans
