SHELL := /bin/bash

-include .env

DOCKER_COMPOSE  ?= docker compose
COMPOSE_RUN_UI  := $(DOCKER_COMPOSE) run --rm ui
COMPOSE_RUN_API := $(DOCKER_COMPOSE) run --rm api

export API_VERSION    ?= $(shell echo "api/src api/package.json api/package-lock.json api/Dockerfile api/tsconfig.json api/tsconfig.build.json" | tr ' ' '\n' | xargs -I '{}' find {} -type f | LC_ALL=C sort | xargs cat | sha1sum - | sed 's/\(......\).*/\1/')
export UI_VERSION     ?= $(shell echo "ui/src ui/package.json ui/package-lock.json ui/Dockerfile ui/tsconfig.json ui/vite.config.ts ui/svelte.config.js ui/postcss.config.cjs ui/tailwind.config.cjs" | tr ' ' '\n' | xargs -I '{}' find {} -type f | LC_ALL=C sort | xargs cat | sha1sum - | sed 's/\(......\).*/\1/')
export E2E_VERSION    ?= $(shell echo "e2e/tests e2e/package.json e2e/package-lock.json e2e/Dockerfile e2e/playwright.config.ts" | tr ' ' '\n' | xargs -I '{}' find {} -type f | LC_ALL=C sort | xargs cat | sha1sum - | sed 's/\(......\).*/\1/')
export API_IMAGE_NAME ?= top-ai-ideas-api
export UI_IMAGE_NAME  ?= top-ai-ideas-ui
export E2E_IMAGE_NAME ?= top-ai-ideas-e2e

.DEFAULT_GOAL := help

.PHONY: help
help:
	@echo "Available targets:"
	@grep -E '^[a-zA-Z0-9_.-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[32m%-25s\033[0m %s\n", $$1, $$2}'

version:
	@echo "API_VERSION: $(API_VERSION)"
	@echo "UI_VERSION: $(UI_VERSION)"

# -----------------------------------------------------------------------------
# Installation & Build
# -----------------------------------------------------------------------------

install-ui:
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec ui npm install ${NPM_LIB}

install-ui-dev:
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec ui npm install ${NPM_LIB} --save-dev

install-api:
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec api npm install ${NPM_LIB}

install-api-dev:
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec api npm install ${NPM_LIB} --save-dev

.PHONY: build
build: build-ui build-api ## Build UI and API artifacts

.PHONY: build-ui-image
build-ui-image: ## Build the UI Docker image for production
	TARGET=production $(DOCKER_COMPOSE) -f docker-compose.yml build --no-cache ui

.PHONY: build-ui
build-ui: ## Build the SvelteKit UI (static)
	TARGET=development $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run ui npm run build

.PHONY: lock-api
lock-api: ## Update API package-lock.json using Node container (sync deps)
	@echo "🔒 Updating API package-lock.json..."
	docker run --rm -v $(PWD)/api:/app -w /app node:20 sh -lc "npm install --package-lock-only"

.PHONY: save-ui
save-ui: ## Save UI Docker image as tar artifact
	@echo "💾 Saving UI image as artifact..."
	@docker save $(REGISTRY)/$(UI_IMAGE_NAME):$(UI_VERSION) -o ui-image.tar

.PHONY: load-ui
load-ui:
	@echo "📥 Loading UI image from artifact..."
	@docker load -i ui-image.tar

.PHONY: build-api-image
build-api-image: ## Build the API Docker image for production
	TARGET=production $(DOCKER_COMPOSE) build --no-cache api

.PHONY: build-api
build-api: build-api-image

.PHONY: save-api
save-api: ## Save API Docker image as tar artifact
	@echo "💾 Saving API image as artifact..."
	@docker save $(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION) -o api-image.tar

.PHONY: load-api
load-api:
	@echo "📥 Loading API image from artifact..."
	@docker load -i api-image.tar

# -----------------------------------------------------------------------------
# Docker helpers
# -----------------------------------------------------------------------------

docker-login:
	@echo "▶ Logging in to registry"
	@echo "$(DOCKER_PASSWORD)" | docker login $(REGISTRY) -u $(DOCKER_USERNAME) --password-stdin

check-api-image: docker-login
	@echo "▶ Checking if image $(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION) exists"
	@docker manifest inspect $(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION) >/dev/null 2>&1 && echo "✅ Image $(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION) exists" || (echo "❌ Image $(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION) does not exist" && exit 1)

pull-api-image: docker-login
	@echo "▶ Pulling image $(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION)"
	@docker pull $(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION) >/dev/null 2>&1 && echo "✅ Image $(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION) downloaded" || (echo "❌ Image $(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION) does not exist" && exit 1)

publish-api-image: docker-login
	@echo "▶ Pushing api image to registry"
	@docker push $(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION)

check-ui-image: docker-login
	@echo "▶ Checking if image $(REGISTRY)/$(UI_IMAGE_NAME):$(UI_VERSION) exists"
	@docker manifest inspect $(REGISTRY)/$(UI_IMAGE_NAME):$(UI_VERSION) >/dev/null 2>&1 && echo "✅ Image $(REGISTRY)/$(UI_IMAGE_NAME):$(UI_VERSION) exists" || (echo "❌ Image $(REGISTRY)/$(UI_IMAGE_NAME):$(UI_VERSION) does not exist" && exit 1)

pull-ui-image: docker-login
	@echo "▶ Pulling image $(REGISTRY)/$(UI_IMAGE_NAME):$(UI_VERSION)"
	@docker pull $(REGISTRY)/$(UI_IMAGE_NAME):$(UI_VERSION) >/dev/null 2>&1 && echo "✅ Image $(REGISTRY)/$(UI_IMAGE_NAME):$(UI_VERSION) downloaded" || (echo "❌ Image $(REGISTRY)/$(UI_IMAGE_NAME):$(UI_VERSION) does not exist" && exit 1)

publish-ui-image: docker-login
	@echo "▶ Pushing ui image to registry"
	@docker push $(REGISTRY)/$(UI_IMAGE_NAME):$(UI_VERSION)

check-e2e-image: docker-login
	@echo "▶ Checking if image $(REGISTRY)/$(E2E_IMAGE_NAME):$(E2E_VERSION) exists"
	@docker manifest inspect $(REGISTRY)/$(E2E_IMAGE_NAME):$(E2E_VERSION) >/dev/null 2>&1 && echo "✅ Image $(REGISTRY)/$(E2E_IMAGE_NAME):$(E2E_VERSION) exists" || (echo "❌ Image $(REGISTRY)/$(E2E_IMAGE_NAME):$(E2E_VERSION) does not exist" && exit 1)

pull-e2e-image: docker-login
	@echo "▶ Pulling image $(REGISTRY)/$(E2E_IMAGE_NAME):$(E2E_VERSION)"
	@docker pull $(REGISTRY)/$(E2E_IMAGE_NAME):$(E2E_VERSION) >/dev/null 2>&1 && echo "✅ Image $(REGISTRY)/$(E2E_IMAGE_NAME):$(E2E_VERSION) downloaded" || (echo "❌ Image $(REGISTRY)/$(E2E_IMAGE_NAME):$(E2E_VERSION) does not exist" && exit 1)

publish-e2e-image: docker-login
	@echo "▶ Pushing e2e image to registry "
	@docker push $(REGISTRY)/$(E2E_IMAGE_NAME):$(E2E_VERSION)


# -----------------------------------------------------------------------------
# Scaleway deployement helpers
# -----------------------------------------------------------------------------
check-scw:
	@if ! command -v scw >/dev/null 2>&1; then \
		echo "ℹ️ scw (Scaleway CLI) not found. Attempting to install..."; \
		curl -sL https://raw.githubusercontent.com/scaleway/scaleway-cli/master/scripts/get.sh | sh && \
		echo "✅ Scaleway CLI installed. You might need to start a new shell for it to be in your PATH."; \
	fi

deploy-api-container-init: check-scw
	@echo "▶️ Creating container $(API_IMAGE_NAME) in namespace $(SCW_NAMESPACE_ID)..."
	@API_CONTAINER_ID=$$(scw container container list | awk '($$2=="$(API_IMAGE_NAME)"){print $$1}'); \
	if [ -n "$${API_CONTAINER_ID}" ]; then \
		echo "✅ Container $(API_IMAGE_NAME) already exists (ID: $${API_CONTAINER_ID})"; \
	else \
		scw container container create \
			name=$(API_IMAGE_NAME) \
			namespace-id=$(SCW_NAMESPACE_ID) \
			registry-image=$(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION) \
			port=8787 \
			min-scale=0 \
			max-scale=1 \
			memory-limit=2048 \
			cpu-limit=1000 \
			timeout=5m \
			privacy=public \
			protocol=http1 && \
		echo "✅ Container $(API_IMAGE_NAME) created successfully"; \
	fi

deploy-api-container: check-scw
	@echo "▶️ Updating new container $(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION) to Scaleway..."
	@API_CONTAINER_ID=$$(scw container container list | awk '($$2=="$(API_IMAGE_NAME)"){print $$1}'); \
	scw container container update $${API_CONTAINER_ID} registry-image="$(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION)" > .deploy_output.log
	@echo "✅ New container deployment initiated."

wait-for-container: check-scw
	@printf "⌛ Waiting for container to become ready.."
	@API_CONTAINER_STATUS="pending"; \
	while [ "$${API_CONTAINER_STATUS}" != "ready" ]; do \
		API_CONTAINER_STATUS=$$(scw container container list | awk '($$2=="$(API_IMAGE_NAME)"){print $$4}'); \
		printf "."; \
		sleep 1; \
	done; \
	printf "\n✅ New container is ready.\n"

deploy-api: deploy-api-container wait-for-container


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
test-ui: up-ui
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec ui npm run test

.PHONY: test-api
test-api: up-api-test test-api-smoke test-api-unit test-api-endpoints test-api-queue test-api-security test-api-ai up-api test-api-limit

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
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.test.yml build e2e

.PHONY: save-e2e
save-e2e:
	@echo "💾 Saving E2E image as artifact..."
	@docker save top-ai-ideas-fullstack-e2e:latest -o e2e-image.tar

.PHONY: load-e2e
load-e2e:
	@echo "📦 Loading E2E image from artifact..."
	@docker load -i e2e-image.tar

.PHONY: run-e2e
run-e2e:
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.test.yml run --rm e2e

.PHONY: test-e2e
test-e2e: up-e2e wait-ready db-seed-test ## Run E2E tests with Playwright (scope with E2E_SPEC)
	# If E2E_SPEC is set, run only that file/glob (e.g., tests/companies.spec.ts)
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.test.yml run --rm -e E2E_SPEC e2e sh -lc ' \
	  if [ -n "$$E2E_SPEC" ]; then \
	    echo "▶ Running scoped Playwright file: $$E2E_SPEC"; \
	    npx playwright test "$$E2E_SPEC"; \
	  else \
	    npx playwright test; \
	  fi'
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
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up --build

.PHONY: dev-ui
dev-ui:
	$(DOCKER_COMPOSE) up --build ui

.PHONY: dev-api
dev-api:
	$(DOCKER_COMPOSE) up --build api

.PHONY: up
up: ## Start the full stack in detached mode
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up --build -d --wait

.PHONY: up-e2e
up-e2e: ## Start stack with test overrides (UI env for API URL)
	ADMIN_EMAIL=e2e-admin@example.com TARGET=production $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.test.yml up -d

.PHONY: up-api
up-api: ## Start the api stack in detached mode
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up --build -d api --wait api

.PHONY: up-api-test
up-api-test: ## Start the api stack in detached mode with DISABLE_RATE_LIMIT=true
	DISABLE_RATE_LIMIT=true $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up --build -d api --wait api

.PHONY: up-ui
up-ui: ## Start the api stack in detached mode
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up --build -d ui

.PHONY: down
down: ## Stop and remove containers, networks, volumes
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml down -v

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
# Workflow: 1) Modify schema.ts → 2) make db-generate → 3) make db-migrate → 4) commit schema + migrations
# db-migrate handles both initial creation (empty DB) and incremental updates
# -----------------------------------------------------------------------------
.PHONY: db-generate
db-generate: ## Generate migration files from schema.ts changes
	$(COMPOSE_RUN_API) npm run db:generate

.PHONY: db-migrate
db-migrate: ## Apply pending migrations (creates tables if DB is empty)
	$(COMPOSE_RUN_API) npm run db:migrate

.PHONY: db-reset
db-reset: up ## Reset database (WARNING: destroys all data)
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
	$(DOCKER_COMPOSE) exec api sh -lc "node dist/tests/utils/seed-test-data.js"

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
.PHONY: test-api-%

test-api-%: ## Run API tests (usage: make test-api-unit, make test-api-queue, SCOPE=admin make test-api-unit)
	@$(DOCKER_COMPOSE) exec -T -e SCOPE="$(SCOPE)" api sh -lc ' \
	  TEST_TYPE="$*"; \
	  if [ -n "$$SCOPE" ]; then \
	    echo "▶ Running scoped $$TEST_TYPE tests: $$SCOPE"; \
	    npm run test:$$TEST_TYPE -- "$$SCOPE"; \
	  else \
	    echo "▶ Running all $$TEST_TYPE tests"; \
	    npm run test:$$TEST_TYPE; \
	  fi'

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
