
SHELL := /bin/bash
DOCKER_COMPOSE ?= docker compose

.DEFAULT_GOAL := help

.PHONY: help
help:
	@echo "Available targets:"
	@grep -E '^[a-zA-Z0-9_.-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[32m%-25s\033[0m %s\n", $$1, $$2}'

# -----------------------------------------------------------------------------
# Installation & Build
# -----------------------------------------------------------------------------
.PHONY: install
install: ## Install UI and API dependencies inside Docker images
	$(DOCKER_COMPOSE) build

.PHONY: build
build: build-ui build-api ## Build UI and API artifacts

.PHONY: build-ui
build-ui: ## Build the SvelteKit UI (static)
	$(DOCKER_COMPOSE) run --rm ui npm run build

.PHONY: build-api
build-api: ## Compile the TypeScript API
	$(DOCKER_COMPOSE) run --rm api npm run build

.PHONY: typecheck
typecheck: typecheck-ui typecheck-api ## Run all type checks

.PHONY: typecheck-ui
typecheck-ui:
	$(DOCKER_COMPOSE) run --rm ui npm run check

.PHONY: typecheck-api
typecheck-api:
	$(DOCKER_COMPOSE) run --rm api npm run typecheck

.PHONY: lint
lint: lint-ui lint-api ## Run all linters

.PHONY: lint-ui
lint-ui:
	$(DOCKER_COMPOSE) run --rm ui npm run lint

.PHONY: lint-api
lint-api:
	$(DOCKER_COMPOSE) run --rm api npm run lint

.PHONY: format
format:
	$(DOCKER_COMPOSE) run --rm ui npm run format
	$(DOCKER_COMPOSE) run --rm api npm run format

.PHONY: format-check
format-check:
	$(DOCKER_COMPOSE) run --rm ui npm run format:check
	$(DOCKER_COMPOSE) run --rm api npm run format:check

.PHONY: audit
audit:
	@echo "Audit to be implemented" && exit 0

# -----------------------------------------------------------------------------
# Testing
# -----------------------------------------------------------------------------
.PHONY: test
test: test-ui test-api ## Run all tests

.PHONY: test-ui
test-ui:
	$(DOCKER_COMPOSE) run --rm ui npm run test

.PHONY: test-api
test-api:
	$(DOCKER_COMPOSE) run --rm api npm run test

.PHONY: test-int
test-int:
	@echo "Integration tests placeholder" && exit 0

.PHONY: test-contract
test-contract:
	@echo "Contract tests placeholder" && exit 0

.PHONY: test-e2e
test-e2e:
	@echo "E2E tests placeholder" && exit 0

.PHONY: test-smoke
test-smoke:
	@echo "Smoke tests placeholder" && exit 0

.PHONY: test-load
test-load:
	@echo "Load tests placeholder" && exit 0

.PHONY: coverage
coverage:
	@echo "Coverage placeholder" && exit 0

.PHONY: coverage-report
coverage-report:
	@echo "Coverage report placeholder" && exit 0

# -----------------------------------------------------------------------------
# Development environment
# -----------------------------------------------------------------------------
.PHONY: dev
dev: ## Start UI and API in watch mode
	$(DOCKER_COMPOSE) up

.PHONY: dev-ui
dev-ui:
	$(DOCKER_COMPOSE) up ui

.PHONY: dev-api
dev-api:
	$(DOCKER_COMPOSE) up api

.PHONY: up
up: ## Start the full stack in detached mode
	$(DOCKER_COMPOSE) up -d

.PHONY: down
down: ## Stop and remove containers, networks, volumes
	$(DOCKER_COMPOSE) down -v

.PHONY: logs
logs:
	$(DOCKER_COMPOSE) logs -f

.PHONY: sh-ui
sh-ui:
	$(DOCKER_COMPOSE) run --rm ui sh

.PHONY: sh-api
sh-api:
	$(DOCKER_COMPOSE) run --rm api sh

# -----------------------------------------------------------------------------
# Database helpers
# -----------------------------------------------------------------------------
.PHONY: db-generate
db-generate:
	$(DOCKER_COMPOSE) run --rm api npm run db:generate

.PHONY: db-migrate
db-migrate:
	$(DOCKER_COMPOSE) run --rm api npm run db:migrate

.PHONY: db-reset
db-reset:
	$(DOCKER_COMPOSE) run --rm api npm run db:reset

.PHONY: db-seed
db-seed:
	$(DOCKER_COMPOSE) run --rm api npm run db:seed

.PHONY: db-lint
db-lint:
	@echo "DB lint placeholder" && exit 0

# -----------------------------------------------------------------------------
# OpenAPI & client generation
# -----------------------------------------------------------------------------
.PHONY: openapi-json
openapi-json:
	$(DOCKER_COMPOSE) run --rm api npm run openapi:json

.PHONY: openapi-html
openapi-html:
	$(DOCKER_COMPOSE) run --rm api npm run openapi:html

.PHONY: client-gen
client-gen:
	$(DOCKER_COMPOSE) run --rm ui npm run client:generate

# -----------------------------------------------------------------------------
# Prompts & AI governance
# -----------------------------------------------------------------------------
.PHONY: prompts-lint
prompts-lint:
	@echo "Prompts lint placeholder" && exit 0

.PHONY: prompts-test
prompts-test:
	@echo "Prompts tests placeholder" && exit 0

.PHONY: prompts-freeze
prompts-freeze:
	@echo "Prompts freeze placeholder" && exit 0

.PHONY: prompts-diff
prompts-diff:
	@echo "Prompts diff placeholder" && exit 0

.PHONY: prompts-doc
prompts-doc:
	@echo "Prompts doc placeholder" && exit 0

# -----------------------------------------------------------------------------
# Security & compliance
# -----------------------------------------------------------------------------
.PHONY: sast
sast:
	@echo "SAST placeholder" && exit 0

.PHONY: secrets-scan
secrets-scan:
	@echo "Secrets scan placeholder" && exit 0

.PHONY: sbom
sbom:
	@echo "SBOM placeholder" && exit 0

.PHONY: license-check
license-check:
	@echo "License check placeholder" && exit 0

.PHONY: dast
dast:
	@echo "DAST placeholder" && exit 0

# -----------------------------------------------------------------------------
# Docker & deployment
# -----------------------------------------------------------------------------
.PHONY: docker-build
docker-build:
	$(DOCKER_COMPOSE) build

.PHONY: docker-push
docker-push:
	@echo "Docker push placeholder" && exit 0

.PHONY: deploy-ui
deploy-ui:
	@echo "Deploy UI placeholder" && exit 0

.PHONY: deploy-api
deploy-api:
	@echo "Deploy API placeholder" && exit 0

.PHONY: release
release:
	@echo "Release pipeline placeholder" && exit 0

.PHONY: tag
tag:
	@echo "Tag placeholder" && exit 0

.PHONY: version-bump
version-bump:
	@echo "Version bump placeholder" && exit 0
