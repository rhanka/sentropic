SHELL := /bin/bash
DOCKER_COMPOSE ?= docker compose
COMPOSE_RUN_UI := $(DOCKER_COMPOSE) run --rm ui
COMPOSE_RUN_API := $(DOCKER_COMPOSE) run --rm api

.DEFAULT_GOAL := help

.PHONY: help
help:
	@echo "Available targets:"
	@grep -E '^[a-zA-Z0-9_.-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[32m%-25s\033[0m %s\n", $$1, $$2}'

# -----------------------------------------------------------------------------
# Installation & Build
# -----------------------------------------------------------------------------
.PHONY: install
install: ## Install UI and API dependencies inside Docker containers
	$(COMPOSE_RUN_API) npm install
	$(COMPOSE_RUN_UI) npm install

.PHONY: build
build: build-ui build-api ## Build UI and API artifacts

.PHONY: build-ui
build-ui: ## Build the SvelteKit UI (static)
	$(COMPOSE_RUN_UI) npm run build

.PHONY: build-api
build-api: ## Compile the TypeScript API
	$(COMPOSE_RUN_API) npm run build

.PHONY: typecheck
typecheck: typecheck-ui typecheck-api ## Run all type checks

.PHONY: typecheck-ui
typecheck-ui:
	$(COMPOSE_RUN_UI) npm run check

.PHONY: typecheck-api
typecheck-api:
	$(COMPOSE_RUN_API) npm run typecheck

.PHONY: lint
lint: lint-ui lint-api ## Run all linters

.PHONY: lint-ui
lint-ui:
	$(COMPOSE_RUN_UI) npm run lint

.PHONY: lint-api
lint-api:
	$(COMPOSE_RUN_API) npm run lint

.PHONY: format
format:
	$(COMPOSE_RUN_UI) npm run format
	$(COMPOSE_RUN_API) npm run format

.PHONY: format-check
format-check:
	$(COMPOSE_RUN_UI) npm run format:check
	$(COMPOSE_RUN_API) npm run format:check

.PHONY: audit
audit:
	@echo "Audit placeholder" && exit 0

# -----------------------------------------------------------------------------
# Testing
# -----------------------------------------------------------------------------
.PHONY: test
test: test-ui test-api ## Run all tests

.PHONY: test-ui
test-ui:
	$(COMPOSE_RUN_UI) npm run test

.PHONY: test-api
test-api:
	$(COMPOSE_RUN_API) npm run test

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
	$(DOCKER_COMPOSE) up --build

.PHONY: dev-ui
dev-ui:
	$(DOCKER_COMPOSE) up --build ui

.PHONY: dev-api
dev-api:
	$(DOCKER_COMPOSE) up --build api

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
	$(COMPOSE_RUN_UI) sh

.PHONY: sh-api
sh-api:
	$(COMPOSE_RUN_API) sh

# -----------------------------------------------------------------------------
# Database helpers
# -----------------------------------------------------------------------------
.PHONY: db-generate
db-generate:
	$(COMPOSE_RUN_API) npm run db:generate

.PHONY: db-migrate
db-migrate:
	$(COMPOSE_RUN_API) npm run db:migrate

.PHONY: db-reset
db-reset:
	$(COMPOSE_RUN_API) npm run db:reset

.PHONY: db-seed
db-seed:
	$(COMPOSE_RUN_API) npm run db:seed

.PHONY: db-lint
db-lint:
	@echo "Database lint placeholder" && exit 0

# -----------------------------------------------------------------------------
# API documentation & client generation
# -----------------------------------------------------------------------------
.PHONY: openapi-json
openapi-json:
	$(COMPOSE_RUN_API) npm run openapi:json

.PHONY: openapi-html
openapi-html:
	$(COMPOSE_RUN_API) npm run openapi:html

.PHONY: client-gen
client-gen:
	$(COMPOSE_RUN_UI) npm run client:generate

# -----------------------------------------------------------------------------
# Prompts workflow
# -----------------------------------------------------------------------------
.PHONY: prompts-lint
prompts-lint:
	@echo "Prompts lint placeholder" && exit 0

.PHONY: prompts-test
prompts-test:
	@echo "Prompts test placeholder" && exit 0

.PHONY: prompts-freeze
prompts-freeze:
	@echo "Prompts freeze placeholder" && exit 0

.PHONY: prompts-diff
prompts-diff:
	@echo "Prompts diff placeholder" && exit 0

.PHONY: prompts-doc
prompts-doc:
	@echo "Prompts documentation placeholder" && exit 0

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
	@echo "Release process placeholder" && exit 0

.PHONY: tag
tag:
	@echo "Tagging placeholder" && exit 0

.PHONY: version-bump
version-bump:
	@echo "Version bump placeholder" && exit 0
