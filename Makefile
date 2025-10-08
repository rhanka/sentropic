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

.PHONY: save-ui
save-ui: ## Save API Docker image as tar artifact
	@echo "💾 Saving API image as artifact..."
	@docker save top-ai-ideas-fullstack-ui:latest -o ui-image.tar

.PHONY: load-ui
load-ui:
	@echo "📥 Loading UI image from artifact..."
	@docker load -i ui-image.tar

.PHONY: build-api
build-api: ## Compile the TypeScript API
	$(COMPOSE_RUN_API) npm run build

.PHONY: save-api
save-api: ## Save API Docker image as tar artifact
	@echo "💾 Saving API image as artifact..."
	@docker save top-ai-ideas-fullstack-api:latest -o api-image.tar

.PHONY: load-api
load-api:
	@echo "📥 Loading API image from artifact..."
	@docker load -i api-image.tar

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
test: test-api test-ui test-e2e ## Run all tests

.PHONY: test-ui
test-ui:
	$(COMPOSE_RUN_UI) npm run test

.PHONY: test-api
test-api: test-api-all
	$(COMPOSE_RUN_API) npm run test

.PHONY: test-int
test-int:
	@echo "Integration tests placeholder" && exit 0

.PHONY: test-contract
test-contract:
	@echo "Contract tests placeholder" && exit 0

.PHONY: wait-ready
wait-ready:
	@echo "⏳ Checking API/UI readiness..."
	@bash -c 'for i in {1..30}; do \
	  curl -sf http://localhost:8787/api/v1/health >/dev/null && curl -sf http://localhost:5173 >/dev/null && exit 0; \
	  echo "Waiting for services... ($$i/30)"; sleep 2; \
	done; echo "Services not ready"; exit 1'

.PHONY: wait-ready-api
wait-ready-api:
	@echo "⏳ Checking API readiness..."
	@bash -c 'for i in {1..30}; do \
	  curl -sf http://localhost:8787/api/v1/health >/dev/null && exit 0; \
	  echo "Waiting for API... ($$i/30)"; sleep 2; \
	done; echo "API not ready"; exit 1'

.PHONY: build-e2e
build-e2e:
	$(DOCKER_COMPOSE) -f docker-compose.test.yml build e2e

.PHONY: save-e2e
save-e2e:
	$(DOCKER_COMPOSE) -f docker-compose.test.yml save e2e -o e2e-image.tar

.PHONY: load-e2e
load-e2e:
	$(DOCKER_COMPOSE) -f docker-compose.test.yml load -i e2e-image.tar

.PHONY: run-e2e
run-e2e:
	$(DOCKER_COMPOSE) -f docker-compose.test.yml run --rm e2e

.PHONY: test-e2e
test-e2e: up wait-ready db-seed-test ## Run E2E tests with Playwright
	$(DOCKER_COMPOSE) -f docker-compose.test.yml run --rm e2e
	@echo "🛑 Stopping services..."
	@$(DOCKER_COMPOSE) down

.PHONY: test-smoke
test-smoke: up wait-ready ## Run smoke tests (quick E2E subset)
	$(DOCKER_COMPOSE) -f docker-compose.test.yml run --rm e2e npx playwright test --grep "devrait charger"
	@echo "🛑 Stopping services..."
	@$(DOCKER_COMPOSE) down

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
# Cleanup
# -----------------------------------------------------------------------------
.PHONY: clean
clean: ## Clean all containers, volumes and images
	$(DOCKER_COMPOSE) down -v --remove-orphans
	docker system prune -f

.PHONY: clean-all
clean-all: clean ## Clean everything including images
	docker system prune -a -f

.PHONY: clean-db
clean-db: ## Clean database files and restart services
	@echo "⚠️  WARNING: This will DELETE ALL DATA in the database!"
	@echo "This action is IRREVERSIBLE and will remove:"
	@echo "  - All companies"
	@echo "  - All folders"
	@echo "  - All use cases"
	@echo "  - All job queue data"
	@echo ""
	@read -p "Are you sure you want to continue? Type 'DELETE' to confirm: " confirm && [ "$$confirm" = "DELETE" ] || (echo "❌ Operation cancelled" && exit 1)
	@echo "🗑️  Cleaning database..."
	$(DOCKER_COMPOSE) down
	rm -f data/app.db*
	@echo "✅ Database cleaned!"
	@echo "🚀 Restarting services..."
	$(MAKE) dev

# -----------------------------------------------------------------------------
# Development environment
# -----------------------------------------------------------------------------
.PHONY: dev
dev: ## Start UI and API in watch mode
	$(DOCKER_COMPOSE) build --no-cache
	$(DOCKER_COMPOSE) up

.PHONY: dev-ui
dev-ui:
	$(DOCKER_COMPOSE) up --build ui

.PHONY: dev-api
dev-api:
	$(DOCKER_COMPOSE) up --build api

.PHONY: up
up: ## Start the full stack in detached mode
	$(DOCKER_COMPOSE) up -d

.PHONY: up-api
up-api: ## Start the api stack in detached mode
	$(DOCKER_COMPOSE) up -d api

.PHONY: down
down: ## Stop and remove containers, networks, volumes
	$(DOCKER_COMPOSE) down -v

# -----------------------------------------------------------------------------
# Logs
# -----------------------------------------------------------------------------
.PHONY: logs
logs: ## Show logs for all services
	$(DOCKER_COMPOSE) logs --tail=50

.PHONY: logs-api
logs-api: ## Show logs for API service
	$(DOCKER_COMPOSE) logs --tail=50 api

.PHONY: logs-ui
logs-ui: ## Show logs for UI service
	$(DOCKER_COMPOSE) logs --tail=50 ui

.PHONY: logs-db
logs-db: ## Show logs for database service
	$(DOCKER_COMPOSE) logs -f sqlite

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
db-reset: ## Reset database (WARNING: destroys all data)
	@echo "⚠️  WARNING: This will DELETE ALL DATA in the database!"
	@echo "This action is IRREVERSIBLE and will remove:"
	@echo "  - All companies"
	@echo "  - All folders" 
	@echo "  - All use cases"
	@echo "  - All job queue data"
	@echo ""
	@read -p "Are you sure you want to continue? Type 'RESET' to confirm: " confirm && [ "$$confirm" = "RESET" ] || (echo "❌ Operation cancelled" && exit 1)
	@echo "🗑️  Resetting database..."
	$(COMPOSE_RUN_API) npm run db:reset

.PHONY: db-init
db-init: ## Initialize database with all migrations
	@echo "🗄️  Initializing database..."
	$(COMPOSE_RUN_API) npm run db:init

.PHONY: db-status
db-status: ## Check database status and tables
	@echo "📊 Database status:"
	$(COMPOSE_RUN_API) npm run db:status

.PHONY: db-backup
db-backup: ## Backup database to file
	@echo "💾 Backing up database..."
	$(COMPOSE_RUN_API) npm run db:backup

.PHONY: db-restore
db-restore: ## Restore database from backup [BACKUP_FILE=filename]
	@echo "🔄 Restoring database from $(BACKUP_FILE)..."
	$(COMPOSE_RUN_API) npm run db:restore $(BACKUP_FILE)

.PHONY: db-fresh
db-fresh: db-backup db-reset db-init ## Fresh start: backup, reset, and initialize database
	@echo "✅ Fresh database setup completed!"

.PHONY: restart-api
restart-api: ## Restart API service
	@echo "🔄 Restarting API service..."
	$(DOCKER_COMPOSE) restart api

.PHONY: restart-db
restart-db: ## Restart database service
	@echo "🔄 Restarting database service..."
	$(DOCKER_COMPOSE) restart sqlite

.PHONY: db-seed
db-seed:
	$(COMPOSE_RUN_API) npm run db:seed

.PHONY: db-seed-test
db-seed-test: ## Seed database with test data for E2E tests
	$(COMPOSE_RUN_API) npx tsx tests/utils/seed-test-data.ts

.PHONY: db-lint
db-lint:
	@echo "Database lint placeholder" && exit 0

# -----------------------------------------------------------------------------
# Security & compliance
# -----------------------------------------------------------------------------
.PHONY: sast
sast:
	@echo "SAST placeholder" && exit 0

.PHONY: secrets-scan
secrets-scan:
	@echo "Secrets scan placeholder" && exit 0

.PHONY: dast
dast:
	@echo "DAST placeholder" && exit 0

# -----------------------------------------------------------------------------
# API Backend Tests (Vitest)
# -----------------------------------------------------------------------------
.PHONY: test-api-smoke test-api-endpoints test-api-ai test-api-queue test-api-all

test-api-smoke: ## Run API smoke tests (basic health checks) [FILTER=*]
	@echo "🧪 Running API smoke tests..."
	@docker exec top-ai-ideas-fullstack-api-1 sh -c "TEST_FILTER=$(FILTER) npm run test:smoke"

test-api-endpoints: ## Run API endpoint tests (CRUD functionality) [ENDPOINT=*] [METHOD=*]
	@echo "🧪 Running API endpoint tests..."
	@docker exec top-ai-ideas-fullstack-api-1 sh -c "TEST_ENDPOINT=$(ENDPOINT) TEST_METHOD=$(METHOD) npm run test:api"

test-api-ai: ## Run API AI tests (generation and enrichment) [TYPE=*] [MODEL=*]
	@echo "🧪 Running API AI tests..."
	@docker exec top-ai-ideas-fullstack-api-1 sh -c "TEST_TYPE=$(TYPE) TEST_MODEL=$(MODEL) npm run test:ai"

test-api-queue: ## Run API queue tests (job processing) [JOB_TYPE=*]
	@echo "🧪 Running API queue tests..."
	@docker exec top-ai-ideas-fullstack-api-1 sh -c "TEST_JOB_TYPE=$(JOB_TYPE) npm run test:queue"

test-api-unit: ## Run API unit tests (pure functions, no external dependencies)
	@echo "🧪 Running API unit tests..."
	@docker exec top-ai-ideas-fullstack-api-1 sh -c "npm run test:unit"

test-api-all: test-api-smoke test-api-unit test-api-endpoints test-api-queue test-api-ai 

# -----------------------------------------------------------------------------
# Queue Management
# -----------------------------------------------------------------------------
.PHONY: queue-clear queue-status queue-reset

queue-clear: ## Clear all pending jobs from the queue
	@echo "🧹 Clearing job queue..."
	@curl -X POST http://localhost:8787/api/v1/queue/purge -H "Content-Type: application/json" -d '{"status": "force"}' || echo "API not available, using fallback"
	@echo "✅ Queue cleared"

queue-status: ## Show current queue status
	@echo "📊 Queue status:"
	@curl -s http://localhost:8787/api/v1/queue/stats | jq . || echo "API not available"

queue-reset: queue-clear ## Reset queue and clear all jobs (alias for queue-clear)
