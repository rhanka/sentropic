# Final release-candidate packing through the existing isolated Compose project.
SHELL := /bin/bash
ENV ?=
export COMPOSE_PROJECT_NAME := $(ENV)
export COMPOSE_DISABLE_ENV_FILE := 1
OUT ?= tmp/final-861
SOURCE_SHA := $(shell git rev-parse HEAD)
COMPOSE := docker compose --env-file /dev/null -p $(ENV) -f docker-compose.immo-861.yml

.PHONY: guard pack down
guard:
	@test "$(ENV)" = test-861-int

pack: guard
	@$(COMPOSE) run --rm --no-deps -u "$$(id -u):$$(id -g)" -e SOURCE_SHA=$(SOURCE_SHA) -e CANDIDATE_OUT=$(OUT) qualification node scripts/ci/immo-861-final-pack.mjs

down: guard
	@$(COMPOSE) down --volumes --remove-orphans
