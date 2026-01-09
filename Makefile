SHELL := /bin/bash

-include .env

DOCKER_COMPOSE  ?= docker compose
COMPOSE_RUN_UI  := $(DOCKER_COMPOSE) run --rm ui
COMPOSE_RUN_API := $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm api

export API_VERSION    ?= $(shell echo "api/src api/tests/utils api/package.json api/package-lock.json api/Dockerfile api/tsconfig.json api/tsconfig.build.json" | tr ' ' '\n' | xargs -I '{}' find {} -type f | LC_ALL=C sort | xargs cat | sha1sum - | sed 's/\(......\).*/\1/')
export UI_VERSION     ?= $(shell echo "ui/src ui/package.json ui/package-lock.json ui/Dockerfile ui/tsconfig.json ui/vite.config.ts ui/svelte.config.js ui/postcss.config.cjs ui/tailwind.config.cjs" | tr ' ' '\n' | xargs -I '{}' find {} -type f | LC_ALL=C sort | xargs cat | sha1sum - | sed 's/\(......\).*/\1/')
export E2E_VERSION    ?= $(shell echo "e2e/tests e2e/helpers e2e/global.setup.ts e2e/package.json e2e/package-lock.json e2e/Dockerfile e2e/playwright.config.ts" | tr ' ' '\n' | xargs -I '{}' find {} -type f | LC_ALL=C sort | xargs cat | sha1sum - | sed 's/\(......\).*/\1/')
export API_IMAGE_NAME ?= top-ai-ideas-api
export UI_IMAGE_NAME  ?= top-ai-ideas-ui
export E2E_IMAGE_NAME ?= top-ai-ideas-e2e

.DEFAULT_GOAL := help

.PHONY: help
help:
	@echo "Available targets:"
	@grep -E '^[a-zA-Z0-9_.-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[32m%-25s\033[0m %s\n", $$1, $$2}'

.PHONY: ps
ps: ## Show docker compose services status (dev stack)
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml ps

.PHONY: ps-all
ps-all: ## Show docker compose services status (dev + test overrides)
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml ps

version:
	@echo "API_VERSION: $(API_VERSION)"
	@echo "UI_VERSION: $(UI_VERSION)"

.PHONY: cloc
cloc: ## Count lines of code (whole repo)
	@cloc --vcs=git --not-match-f='(package.*\.json|.*_snapshot\.json)$$'

.PHONY: test-cloc
test-cloc: ## Count lines of code (tests only: api/tests ui/tests e2e/tests)
	@cloc --vcs=git --not-match-f='(package.*\.json|.*_snapshot\.json)$$' api/tests ui/tests e2e/tests

.PHONY: cloc-test
cloc-test: ## (deprecated) Alias for test-cloc
	@$(MAKE) --no-print-directory test-cloc

.PHONY: test-count
test-count: ## Count tests (files + test cases): UI unit, API unit (excluding ai), API integration (ai), E2E
	@TEST_REGEX='(^|[^[:alnum:]_])(test|it)(\.(skip|only|each|concurrent|fails|todo|fixme))*[[:space:]]*[(]'; \
	ui_files=$$(find ui/tests -type f \( -name "*.test.ts" -o -name "*.spec.ts" \) -print | wc -l | tr -d ' '); \
	ui_tests=$$(find ui/tests -type f \( -name "*.test.ts" -o -name "*.spec.ts" \) -print0 | xargs -0r grep -REho "$$TEST_REGEX" | wc -l | tr -d ' '); \
	api_unit_files=$$(find api/tests -type f \( -name "*.test.ts" -o -name "*.spec.ts" \) ! -path "api/tests/ai/*" -print | wc -l | tr -d ' '); \
	api_unit_tests=$$(find api/tests -type f \( -name "*.test.ts" -o -name "*.spec.ts" \) ! -path "api/tests/ai/*" -print0 | xargs -0r grep -REho "$$TEST_REGEX" | wc -l | tr -d ' '); \
	api_ai_files=$$(find api/tests/ai -type f \( -name "*.test.ts" -o -name "*.spec.ts" \) -print 2>/dev/null | wc -l | tr -d ' '); \
	api_ai_tests=$$(find api/tests/ai -type f \( -name "*.test.ts" -o -name "*.spec.ts" \) -print0 2>/dev/null | xargs -0r grep -REho "$$TEST_REGEX" | wc -l | tr -d ' '); \
	e2e_files=$$(find e2e/tests -type f -name "*.spec.ts" ! -path "e2e/tests/fixtures/*" ! -path "e2e/tests/helpers/*" -print | wc -l | tr -d ' '); \
	e2e_tests=$$(find e2e/tests -type f -name "*.spec.ts" ! -path "e2e/tests/fixtures/*" ! -path "e2e/tests/helpers/*" -print0 | xargs -0r grep -REho "$$TEST_REGEX" | wc -l | tr -d ' '); \
	total_files=$$((ui_files + api_unit_files + api_ai_files + e2e_files)); \
	total_tests=$$((ui_tests + api_unit_tests + api_ai_tests + e2e_tests)); \
	echo "📊 Comptage des tests (approx.)"; \
	echo ""; \
	printf "%-28s %10s %10s\n" "Scope" "Fichiers" "Tests"; \
	printf "%-28s %10s %10s\n" "----------------------------" "----------" "----------"; \
	printf "%-28s %10s %10s\n" "UI (unitaires)" "$$ui_files" "$$ui_tests"; \
	printf "%-28s %10s %10s\n" "API (unitaires, sans ai)" "$$api_unit_files" "$$api_unit_tests"; \
	printf "%-28s %10s %10s\n" "API (integration = ai)" "$$api_ai_files" "$$api_ai_tests"; \
	printf "%-28s %10s %10s\n" "E2E (Playwright)" "$$e2e_files" "$$e2e_tests"; \
	printf "%-28s %10s %10s\n" "TOTAL" "$$total_files" "$$total_tests"; \
	echo ""; \
	echo "Note: comptage basé sur occurrences de test()/it() (+ .only/.skip/.each/.concurrent/.fails/.todo/.fixme)."

.PHONY: git-stats
git-stats: ## Show git stats (commits, merged PR via merge commits)
	@set -euo pipefail; \
	if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then \
	  echo "❌ Not a git repository"; exit 1; \
	fi; \
	branch="$$(git rev-parse --abbrev-ref HEAD)"; \
	commits="$$(git rev-list --count HEAD)"; \
	merged_pr_merge_commits="$$(git log --merges --grep='Merge pull request #' --pretty=format:%s | wc -l | tr -d ' ')"; \
	merged_pr_union="$$( ( \
	  git log --merges --grep='Merge pull request #' --pretty=format:%s | sed -nE 's/.*#([0-9]+).*/\1/p'; \
	  git log --pretty=format:%s | sed -nE 's/.*\(#([0-9]+)\)\s*$$/\1/p' \
	) | sort -n | uniq | wc -l | tr -d ' ')"; \
	last="$$(git log -1 --pretty=format:'%h %ad %s' --date=short)"; \
	echo "📌 Branche: $$branch"; \
	echo "🧱 Commits (HEAD): $$commits"; \
	echo "🔀 PR mergées (merge commits 'Merge pull request #...'): $$merged_pr_merge_commits"; \
	echo "🧮 PR mergées (approx, PR # uniques détectées): $$merged_pr_union"; \
	echo "🕒 Dernier commit: $$last"; \
	if [ "$$merged_pr_union" != "$$merged_pr_merge_commits" ]; then \
	  echo ""; \
	  echo "Note: les PR squash/rebase ne laissent pas toujours de trace fiable dans git; utiliser l’API GitHub pour un chiffre exact."; \
	fi

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

update-%:
	@echo "🔒 Updating $* ..."
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec $* sh -lc "npm update"

audit-fix-%:
	@echo "🔒 audit fixing $* ..."
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec $* sh -lc "npm audit fix"

.PHONY: lock-api
lock-api: ## Update API package-lock.json using Node container (sync deps)
	@echo "🔒 Updating API package-lock.json..."
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec api sh -lc "npm install --package-lock-only"

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
typecheck-ui: up-ui ## Run UI type checks
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T ui npm run check

.PHONY: typecheck-api
typecheck-api: up-api ## Run API type checks
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T api npm run typecheck

.PHONY: lint
lint: lint-ui lint-api ## Run all linters

.PHONY: lint-ui
lint-ui: up-ui ## Run UI linter
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T ui npm run lint

.PHONY: lint-api
lint-api: up-api ## Run API linter
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T api npm run lint

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
test-ui: up-ui ## Run UI tests (usage: make test-ui, SCOPE=tests/stores/session.test.ts make test-ui)
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T -e SCOPE="$(SCOPE)" ui sh -lc ' \
	  if [ -n "$$SCOPE" ]; then \
	    echo "▶ Running scoped UI tests: $$SCOPE"; \
	    npm run test -- "$$SCOPE"; \
	  else \
	    echo "▶ Running all UI tests"; \
	    npm run test; \
	  fi'

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

.PHONY: e2e-set-queue
# Defaults for CI
QUEUE_CONCURRENCY ?= 30

.PHONY: test-e2e
test-e2e: up-e2e wait-ready db-seed-test e2e-set-queue ## Run E2E tests with Playwright (scope with E2E_SPEC)
	# Options:
	# - WORKERS (default: 4)
	# - RETRIES (default: 0)        -> force "fail fast" (no retries)
	# - MAX_FAILURES (optional)    -> if set, pass --max-failures=<n> (otherwise show all failures)
	# - QUEUE_CONCURRENCY (default: 30) -> upsert settings.ai_concurrency before running tests
	# - QUEUE_PROCESSING_INTERVAL (optional) -> upsert settings.queue_processing_interval (ms)
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.test.yml run --rm --no-deps \
	  -e E2E_SPEC -e WORKERS -e RETRIES -e MAX_FAILURES \
	  e2e sh -lc ' \
	    workers="$${WORKERS:-4}"; \
	    retries="$${RETRIES:-0}"; \
	    max_fail="$${MAX_FAILURES:-}"; \
	    extra=""; \
	    if [ -n "$$max_fail" ]; then extra="--max-failures=$$max_fail"; fi; \
	    if [ -n "$$E2E_SPEC" ]; then \
	      echo "▶ Running scoped Playwright: $$E2E_SPEC (workers=$$workers retries=$$retries $${extra:-})"; \
	      npx playwright test "$$E2E_SPEC" --workers="$$workers" --retries="$$retries" $$extra; \
	    else \
	      echo "▶ Running Playwright (workers=$$workers retries=$$retries $${extra:-})"; \
	      npx playwright test --workers="$$workers" --retries="$$retries" $$extra; \
	    fi'
	@echo "🛑 Stopping services..."
	@$(DOCKER_COMPOSE) down

e2e-set-queue: ## (E2E) Tweak queue settings in DB (defaults: QUEUE_CONCURRENCY=30)
	@set -e; \
	echo "🔧 Updating queue settings in DB for E2E..."; \
	echo " - ai_concurrency=$(QUEUE_CONCURRENCY)"; \
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.test.yml exec -T postgres sh -lc '\
	  psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -v ON_ERROR_STOP=1 -c \
	    "INSERT INTO settings (key,value,description,updated_at) VALUES (''ai_concurrency'',''$(QUEUE_CONCURRENCY)'',''E2E override: concurrent AI jobs'',NOW()) \
	     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at;"; \
	  if [ -n "$(QUEUE_PROCESSING_INTERVAL)" ]; then \
	    echo " - queue_processing_interval=$(QUEUE_PROCESSING_INTERVAL)"; \
	    psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -v ON_ERROR_STOP=1 -c \
	      "INSERT INTO settings (key,value,description,updated_at) VALUES (''queue_processing_interval'',''$(QUEUE_PROCESSING_INTERVAL)'',''E2E override: queue tick (ms)'',NOW()) \
	       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at;"; \
	  fi'; \
	echo "🔄 Restarting API to reload queue settings..."; \
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.test.yml restart api >/dev/null

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

.PHONY: clean-all
clean-all: clean ## Clean everything including images
	docker system prune -a -f

.PHONY: clean-db
clean-db: ## Clean database files and restart services [SKIP_CONFIRM=true to skip prompt]
	@echo "⚠️  WARNING: This will DELETE ALL DATA in the database!"
	@echo "This action is IRREVERSIBLE and will remove:"
	@echo "  - All organization"
	@echo "  - All folders"
	@echo "  - All use cases"
	@echo "  - All job queue data"
	@echo ""
	@if [ "$(SKIP_CONFIRM)" != "true" ]; then \
		read -p "Are you sure you want to continue? Type 'DELETE' to confirm: " confirm && [ "$$confirm" = "DELETE" ] || (echo "❌ Operation cancelled" && exit 1); \
	fi
	@echo "🗑️  Cleaning database..."
	$(DOCKER_COMPOSE) down
	@docker volume rm top-ai-ideas-fullstack_pg_data || true
	@echo "✅ Database cleaned!"
	@echo "🚀 Restarting services..."

# -----------------------------------------------------------------------------
# Development environment
# -----------------------------------------------------------------------------
.PHONY: dev
dev: ## Start UI and API in watch mode
	DISABLE_RATE_LIMIT=true $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up --build -d

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
	DISABLE_RATE_LIMIT=true ADMIN_EMAIL=e2e-admin@example.com TARGET=production $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.test.yml up -d

.PHONY: up-api
up-api: ## Start the api stack in detached mode
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up --build -d api --wait api

.PHONY: up-api-test
up-api-test: ## Start the api stack in detached mode with DISABLE_RATE_LIMIT=true
	DISABLE_RATE_LIMIT=true $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up --build -d api --wait api

.PHONY: up-ui
up-ui: ## Start the ui stack in detached mode
	TARGET=development $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up --build -d ui --wait ui

.PHONY: down
down: ## Stop and remove containers, networks, volumes
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml down


# -----------------------------------------------------------------------------
# Logs
# -----------------------------------------------------------------------------
.PHONY: logs
logs: ## Show logs for all services
	$(DOCKER_COMPOSE) logs

.PHONY: logs-% # maildev postgres ui api
logs-%: ## Show logs for MailDev service
	@if [ -n "$$TAIL" ]; then \
		$(DOCKER_COMPOSE) logs --tail=$$TAIL $*; \
	else \
		$(DOCKER_COMPOSE) logs $*; \
	fi

.PHONY: sh-ui
sh-ui:
	$(COMPOSE_RUN_UI) sh

.PHONY: sh-api
sh-api:
	$(COMPOSE_RUN_API) sh

.PHONY: exec-api
exec-api: ## Exec a command in the running api container: make exec-api CMD="node -v"
	@if [ -z "$$CMD" ]; then \
		echo "Usage: make exec-api CMD=\"<command>\""; \
		exit 2; \
	fi
	@if [ "$$(docker compose -f docker-compose.yml -f docker-compose.dev.yml ps -q api 2>/dev/null | wc -l)" -eq 0 ]; then \
		echo "api container is not running. Start it first (e.g. make up / make dev / make up-api-test)."; \
		exit 1; \
	fi
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec api sh -lc "$$CMD"

.PHONY: exec-api-sh
exec-api-sh: ## Open a shell in the running api container
	@if [ "$$(docker compose -f docker-compose.yml -f docker-compose.dev.yml ps -q api 2>/dev/null | wc -l)" -eq 0 ]; then \
		echo "api container is not running. Start it first (e.g. make up / make dev / make up-api-test)."; \
		exit 1; \
	fi
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec api sh

# -----------------------------------------------------------------------------
# Database helpers
# Workflow: 1) Modify schema.ts → 2) make db-generate → 3) make db-migrate → 4) commit schema + migrations
# db-migrate handles both initial creation (empty DB) and incremental updates
# -----------------------------------------------------------------------------
.PHONY: db-generate
db-generate: ## Generate migration files from schema.ts changes (uses exec if container running, otherwise run)
	@if [ "$$(docker compose -f docker-compose.yml -f docker-compose.dev.yml ps -q api 2>/dev/null | wc -l)" -gt 0 ]; then \
		$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec api npm run db:generate; \
	else \
		$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm api sh -lc "npm ci --include=dev && npm run db:generate"; \
	fi

.PHONY: db-migrate
db-migrate: ## Apply pending migrations (creates tables if DB is empty)
	$(COMPOSE_RUN_API) npm run db:migrate

.PHONY: db-reset
db-reset: up ## Reset database (WARNING: destroys all data) [SKIP_CONFIRM=true to skip prompt]
	@echo "⚠️  WARNING: This will DELETE ALL DATA in the database!"
	@echo "This action is IRREVERSIBLE and will remove:"
	@echo "  - All users and session"
	@echo "  - All organizations"
	@echo "  - All folders"
	@echo "  - All use cases"
	@echo "  - All job queue data"
	@echo ""
	@if [ "$(SKIP_CONFIRM)" != "true" ]; then \
		read -p "Are you sure you want to continue? Type 'RESET' to confirm: " confirm && [ "$$confirm" = "RESET" ] || (echo "❌ Operation cancelled" && exit 1); \
	fi
	@echo "🗑️  Resetting database..."
	$(COMPOSE_RUN_API) npm run db:reset

.PHONY: db-status
db-status: ## Check database status and tables
	@echo "📊 Database status:"
	$(COMPOSE_RUN_API) npm run db:status

.PHONY: db-inspect
db-inspect: up ## Inspect database directly via postgres container (query database state)
	@echo "📊 Database Inspection:"
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T postgres psql -U app -d app -c "\
		SELECT 'use_cases' as table_name, COUNT(*) as count FROM use_cases \
		UNION ALL \
		SELECT 'folders', COUNT(*) FROM folders \
		UNION ALL \
		SELECT 'organizations', COUNT(*) FROM organizations \
		UNION ALL \
		SELECT 'users', COUNT(*) FROM users \
		UNION ALL \
		SELECT 'user_sessions', COUNT(*) FROM user_sessions;"

.PHONY: db-query
db-query: up ## Execute a custom SQL query (usage: make db-query QUERY="SELECT * FROM organizations")
	@if [ -z "$(QUERY)" ]; then \
		echo "❌ Error: QUERY parameter is required"; \
		echo "Usage: make db-query QUERY=\"SELECT * FROM organizations\""; \
		exit 1; \
	fi
	@echo "📊 Executing query:"
	@echo "$(QUERY)"
	@echo ""
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T postgres psql -U app -d app -c "$(QUERY)"

.PHONY: db-inspect-usecases
db-inspect-usecases: up ## Inspect use cases and folders relationship
	@echo "📊 Use Cases Details:"
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T postgres psql -U app -d app -c "\
		SELECT uc.id, uc.name, uc.folder_id, f.name as folder_name, uc.organization_id, o.name as organization_name \
		FROM use_cases uc \
		LEFT JOIN folders f ON uc.folder_id = f.id \
		LEFT JOIN organizations o ON uc.organization_id = o.id \
		ORDER BY uc.created_at DESC \
		LIMIT 20;"

.PHONY: db-inspect-folders
db-inspect-folders: up ## Inspect folders and their use cases count
	@echo "📊 Folders Details:"
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T postgres psql -U app -d app -c "\
		SELECT f.id, f.name, f.description, COUNT(uc.id) as use_cases_count \
		FROM folders f \
		LEFT JOIN use_cases uc ON f.id = uc.folder_id \
		GROUP BY f.id, f.name, f.description \
		ORDER BY f.created_at DESC;"

.PHONY: db-inspect-users
db-inspect-users: up ## Inspect users and their roles
	@echo "📊 Users Details:"
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T postgres psql -U app -d app -c "\
		SELECT id, email, display_name, role, created_at \
		FROM users \
		ORDER BY created_at DESC;"

backup-dir:
	@mkdir -p data/backup

.PHONY: db-backup
db-backup: backup-dir up ## Backup local database to file
	@echo "💾 Creating backup from local database..."
	@TIMESTAMP=$$(date +%Y-%m-%dT%H-%M-%S); \
	BACKUP_FILE="data/backup/app-$${TIMESTAMP}.dump"; \
	echo "▶ Backing up to $${BACKUP_FILE}..."; \
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T postgres sh -lc "\
		if [ -n \"$$DATABASE_URL\" ]; then \
			pg_dump \"$$DATABASE_URL\" -F c -f /backups/app-$${TIMESTAMP}.dump; \
		else \
			export PGPASSWORD=\"app\"; \
			pg_dump -h localhost -U app -d app -F c -f /backups/app-$${TIMESTAMP}.dump; \
		fi" && \
	echo "✅ Backup created: $${BACKUP_FILE}"

.PHONY: db-backup-prod
db-backup-prod: backup-dir up ## Backup production database from Scaleway to local file (uses DATABASE_URL_PROD from .env)
	@echo "💾 Creating backup from Scaleway production database..."
	@if [ -z "$$DATABASE_URL_PROD" ]; then \
		echo "❌ Error: DATABASE_URL_PROD must be set in .env file"; \
		exit 1; \
	fi
	@if [ -z "$$DB_SSL_CA_PEM_B64" ]; then \
		echo "❌ Error: DB_SSL_CA_PEM_B64 must be set (base64-encoded CA PEM)"; \
		exit 1; \
	fi
	@TIMESTAMP=$$(date +%Y-%m-%dT%H-%M-%S); \
	BACKUP_FILE="data/backup/prod-$${TIMESTAMP}.dump"; \
	echo "▶ Backing up to $${BACKUP_FILE}..."; \
	docker run --rm \
		-v $(PWD)/data/backup:/backups \
		-e DATABASE_URL_PROD="$$DATABASE_URL_PROD" \
		-e DB_SSL_CA_PEM_B64="$$DB_SSL_CA_PEM_B64" \
		postgres:17-alpine sh -lc " \
			printf '%s' \"$$DB_SSL_CA_PEM_B64\" | base64 -d > /tmp/ca.pem && \
			export PGSSLMODE=verify-full && \
			export PGSSLROOTCERT=/tmp/ca.pem && \
		pg_dump \"$$DATABASE_URL_PROD\" -F c -f /backups/prod-$${TIMESTAMP}.dump"; \
	echo "✅ Backup created: $${BACKUP_FILE}"

.PHONY: db-restore
db-restore: clean ## Restore backup to local database [BACKUP_FILE=filename.dump] ⚠ approval [SKIP_CONFIRM=true to skip prompt]
	@if [ -z "$(BACKUP_FILE)" ]; then \
		echo "❌ Error: BACKUP_FILE must be specified (e.g., BACKUP_FILE=app-2025-01-15T10-30-00.dump or BACKUP_FILE=prod-2025-01-15T10-30-00.dump)"; \
		echo "Available backups:"; \
		ls -1 data/backup/*.dump 2>/dev/null | awk '{print "BACKUP_FILE=" $$1}' || echo "  No backups found"; \
		exit 1; \
	fi
	@echo "⚠️  WARNING: This will REPLACE all data in local database!"
	@echo "This action is DESTRUCTIVE and will remove:"
	@echo "  - All local organizations, folders, use cases"
	@echo "  - All local users and sessions"
	@echo "  - All local settings and configuration"
	@echo ""
	@if [ "$(SKIP_CONFIRM)" != "true" ]; then \
		read -p "Are you sure you want to continue? Type 'RESTORE' to confirm: " confirm && [ "$$confirm" = "RESTORE" ] || (echo "❌ Operation cancelled" && exit 1); \
	fi
	@if [ ! -f "data/backup/$(BACKUP_FILE)" ]; then \
		echo "❌ Error: Backup file not found: data/backup/$(BACKUP_FILE)"; \
		exit 1; \
	fi
	@echo "🚀 Starting PostgreSQL service..."
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up -d postgres --wait
	@echo "🔄 Restoring backup to local database..."
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml cp data/backup/$(BACKUP_FILE) postgres:/tmp/restore.dump
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T postgres sh -c " \
		pg_restore -d postgres://app:app@localhost:5432/app --clean --if-exists --no-owner --no-privileges -v /tmp/restore.dump && rm /tmp/restore.dump"
	@echo "📊 Inspecting database after restore (before migrations)..."
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T postgres psql -U app -d app -c "\
		SELECT 'use_cases' as table_name, COUNT(*) as count FROM use_cases \
		UNION ALL \
		SELECT 'folders', COUNT(*) FROM folders \
		UNION ALL \
		SELECT 'organizations', COUNT(*) FROM organizations \
		UNION ALL \
		SELECT 'settings', COUNT(*) FROM settings \
		UNION ALL \
		SELECT 'business_config', COUNT(*) FROM business_config \
		UNION ALL \
		SELECT 'job_queue', COUNT(*) FROM job_queue;"
	@echo "📋 Checking for WebAuthn tables (may not exist in old backups)..."
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T postgres psql -U app -d app -c "\
		SELECT table_name FROM information_schema.tables \
		WHERE table_schema = 'public' \
		AND table_name IN ('users', 'user_sessions', 'webauthn_credentials', 'webauthn_challenges', 'magic_links') \
		ORDER BY table_name;" || echo "  (WebAuthn tables not found - will be created by migrations)"

.PHONY: db-fresh
db-fresh: db-backup db-reset db-init ## Fresh start: backup, reset, and initialize database
	@echo "✅ Fresh database setup completed!"

.PHONY: restart-api
restart-api: ## Restart API service
	@echo "🔄 Restarting API service..."
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml restart api

.PHONY: restart-db
restart-db: ## Restart database service
	@echo "🔄 Restarting database service..."
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml restart sqlite

.PHONY: db-seed
db-seed:
	$(COMPOSE_RUN_API) npm run db:seed

.PHONY: db-seed-test
db-seed-test: ## Seed database with test data for E2E tests
	$(DOCKER_COMPOSE) exec api sh -lc "node dist/tests/utils/seed-test-data.js"

.PHONY: db-migrate-data
db-migrate-data: ## Migrate use_cases data to JSONB data field
	$(COMPOSE_RUN_API) npm run db:migrate-data

.PHONY: db-create-indexes
db-create-indexes: ## Create recommended indexes for use_cases table
	$(COMPOSE_RUN_API) npm run db:create-indexes

.PHONY: db-lint
db-lint:
	@echo "Database lint placeholder" && exit 0

# -----------------------------------------------------------------------------
# Component auditing
# -----------------------------------------------------------------------------

# Generic component audit pattern: audit-<service> COMPONENT=<component>
# Usage examples:
#   make audit-api COMPONENT=node          # Check Node.js version
#   make audit-api COMPONENT=hono          # Check Hono library version
#   make audit-api COMPONENT=drizzle-orm   # Check Drizzle ORM library version
#   make audit-api COMPONENT=npm           # Check all outdated npm packages
#   make audit-ui COMPONENT=node           # Check Node.js version
#   make audit-ui COMPONENT=svelte         # Check Svelte library version
#   make audit-ui COMPONENT=vite           # Check Vite library version
#   make audit-ui COMPONENT=npm            # Check all outdated npm packages
#   make audit-infra COMPONENT=node        # Check Node.js base image version
#   make audit-infra COMPONENT=docker      # Check Docker version
# Services: api, ui, infra
# Component: node (for Node.js version) or any npm package name (for library version check)
.PHONY: audit-%
audit-%: ## Audit components for service (usage: make audit-<service> COMPONENT=<component>)
	@if [ -z "$(COMPONENT)" ]; then \
		echo "❌ Error: COMPONENT variable not set"; \
		echo "Usage: make audit-$* COMPONENT=<component>"; \
		echo "Examples:"; \
		echo "  make audit-$* COMPONENT=node     # Check Node.js version"; \
		echo "  make audit-$* COMPONENT=<lib>    # Check library version (e.g., hono, svelte, vite)"; \
		echo "  make audit-$* COMPONENT=npm      # Check all outdated npm packages"; \
		exit 1; \
	fi; \
	if [ "$*" = "api" ] || [ "$*" = "ui" ]; then \
		if [ "$(COMPONENT)" = "node" ]; then \
			echo "📦 Checking Node.js version for $*..."; \
			$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps -e TARGET=development --entrypoint="" $* node --version; \
		elif [ "$(COMPONENT)" = "npm" ]; then \
			echo "📦 Auditing NPM packages for $*..."; \
			$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps -e TARGET=development $* npm outdated || echo 'No outdated packages'; \
		elif [ "$(COMPONENT)" = "nginx" ] && [ "$*" = "ui" ]; then \
			echo "🌐 Checking Nginx version (ui production)..."; \
			$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps -e TARGET=production ui nginx -v; \
		else \
			echo "📦 Checking $(COMPONENT) version for $*..."; \
			$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps -e TARGET=development $* sh -c "grep '\"$(COMPONENT)\"' package.json && npm view $(COMPONENT) version"; \
		fi; \
	elif [ "$*" = "infra" ]; then \
		if [ "$(COMPONENT)" = "docker" ]; then \
			echo "🐳 Checking Docker version..."; \
			docker --version; \
			$(DOCKER_COMPOSE) --version; \
		elif [ "$(COMPONENT)" = "postgres" ]; then \
			echo "🐘 Checking PostgreSQL version..."; \
			$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps postgres postgres --version; \
		elif [ "$(COMPONENT)" = "nginx" ]; then \
			echo "🌐 Checking Nginx version..."; \
			TARGET=production $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps ui nginx -v; \
		elif [ "$(COMPONENT)" = "maildev" ]; then \
			echo "📧 Checking MailDev version..."; \
			$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps maildev --version 2>/dev/null || \
			grep "image:" docker-compose.yml | grep maildev | sed 's/.*image: *\(.*\)/\1/' || echo "maildev/maildev:2.0.5"; \
		else \
			echo "❌ Unknown component for infra: $(COMPONENT)"; \
			echo "Available components: docker, postgres, nginx, maildev"; \
			exit 1; \
		fi; \
	else \
		echo "❌ Unknown service: $*"; \
		echo "Available services: api, ui, infra"; \
		exit 1; \
	fi

# -----------------------------------------------------------------------------
# Security & compliance
# -----------------------------------------------------------------------------

# Generic security test pattern: test-<service>-security-<type>
# Usage: make test-api-security-sast, make test-ui-security-sca, etc.
# Services: api, ui
# Types: sast (Semgrep), sca (Trivy SCA), container (Trivy image)
.PHONY: test-%-security-sast
test-%-security-sast: ## Run SAST scan (Semgrep) on service (usage: make test-api-security-sast, make test-ui-security-sast)
	@echo "🔒 Security: Running SAST scan on $*..."
	@mkdir -p .security
	@echo "  📋 Step 1: Executing Semgrep scan..."
	@docker run --rm -v "${PWD}/$*/src:/src" semgrep/semgrep semgrep scan --config auto --severity ERROR --json > .security/sast-$*.json || true
	@echo "  📋 Step 2: Parsing results to structured format..."
	@bash scripts/security/security-parser.sh sast .security/sast-$*.json .security/sast-$*-parsed.yaml $* || exit 1
	@echo "  📋 Step 3: Checking compliance against vulnerability register..."
	@bash scripts/security/security-compliance.sh sast $* || exit 1
	@echo "✅ SAST scan completed for $*"

.PHONY: test-%-security-sca
test-%-security-sca: ## Run SCA scan (Trivy) on service (usage: make test-api-security-sca, make test-ui-security-sca)
	@echo "🔒 Security: Running SCA scan on $*..."
	@mkdir -p .security
	@echo "  📋 Step 1: Executing Trivy SCA scan..."
	@docker run --rm -v "${PWD}/$*:/src" aquasec/trivy fs --security-checks vuln --severity HIGH,CRITICAL --format json --quiet /src > .security/sca-$*.json || true
	@echo "  📋 Step 2: Parsing results to structured format..."
	@bash scripts/security/security-parser.sh sca .security/sca-$*.json .security/sca-$*-parsed.yaml $* || exit 1
	@echo "  📋 Step 3: Checking compliance against vulnerability register..."
	@bash scripts/security/security-compliance.sh sca $* || exit 1
	@echo "✅ SCA scan completed for $*"

.PHONY: test-%-security-container
test-%-security-container: ## Run container scan (Trivy) on service image (usage: make test-api-security-container, make test-ui-security-container)
	@echo "🔒 Security: Running container scan on $*..."
	@mkdir -p .security
	@echo "  📋 Step 1: Executing Trivy container scan..."
	@if [ "$*" = "api" ]; then \
		IMAGE_NAME="$(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION)"; \
	elif [ "$*" = "ui" ]; then \
		IMAGE_NAME="$(REGISTRY)/$(UI_IMAGE_NAME):$(UI_VERSION)"; \
	else \
		IMAGE_NAME="top-ai-ideas-$*:latest"; \
	fi; \
	echo "  Scanning image: $$IMAGE_NAME"; \
	docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy image --severity HIGH,CRITICAL --format json --quiet $$IMAGE_NAME > .security/container-$*.json || (echo '{"Results": []}' > .security/container-$*.json && echo "  ⚠️  Image not found: $$IMAGE_NAME")
	@echo "  📋 Step 2: Parsing results to structured format..."
	@bash scripts/security/security-parser.sh container .security/container-$*.json .security/container-$*-parsed.yaml $* || exit 1
	@echo "  📋 Step 3: Checking compliance against vulnerability register..."
	@bash scripts/security/security-compliance.sh container $* || exit 1
	@echo "✅ Container scan completed for $*"

.PHONY: test-security-iac
test-security-iac: ## Run IaC scan (Trivy) on infrastructure configs (docker-compose.yml, Makefile)
	@echo "🔒 Security: Running IaC scan on infrastructure..."
	@mkdir -p .security
	@echo "  📋 Step 1: Executing Trivy IaC scan..."
	@docker run --rm -v "${PWD}:/src" aquasec/trivy config --severity HIGH,CRITICAL --format json --quiet /src/docker-compose.yml > .security/iac-infra.json || true
	@docker run --rm -v "${PWD}:/src" aquasec/trivy config --severity HIGH,CRITICAL --format json --quiet /src/Makefile >> .security/iac-infra.json || true
	@echo "  📋 Step 2: Parsing results to structured format..."
	@bash scripts/security/security-parser.sh iac .security/iac-infra.json .security/iac-infra-parsed.yaml infra || exit 1
	@echo "  📋 Step 3: Checking compliance against vulnerability register..."
	@bash scripts/security/security-compliance.sh iac infra || exit 1
	@echo "✅ IaC scan completed"

# Aggregate security tests by type
.PHONY: test-security-sast
test-security-sast: test-api-security-sast test-ui-security-sast ## Run SAST scans on all services
	@echo "✅ All SAST tests completed"

.PHONY: test-security-sca
test-security-sca: test-api-security-sca test-ui-security-sca ## Run SCA scans on all services
	@echo "✅ All SCA tests completed"

.PHONY: test-security-container
test-security-container: test-api-security-container test-ui-security-container ## Run container scans on all service images
	@echo "✅ All container tests completed"

# Main security test aggregate
.PHONY: test-security
test-security: test-security-sast test-security-sca test-security-container test-security-iac ## Run all security tests (SAST, SCA, Container, IaC)
	@echo "✅ All security tests completed"

# -----------------------------------------------------------------------------
# API Backend Tests (Vitest)
# -----------------------------------------------------------------------------
.PHONY: test-api-%

test-api-%: ## Run API tests (usage: make test-api-unit, make test-api-queue, SCOPE=admin make test-api-unit)
	@$(DOCKER_COMPOSE) exec -T -e SCOPE="$(SCOPE)" api sh -lc ' \
	  TEST_TYPE="$*"; \
	  if [ -n "$$SCOPE" ]; then \
	    echo "▶ Running scoped $$TEST_TYPE tests: $$SCOPE"; \
	    npx vitest run "$$SCOPE"; \
	  else \
	    echo "▶ Running all $$TEST_TYPE tests"; \
	    npm run test:$$TEST_TYPE; \
	  fi'

.PHONY: test-api-smoke-restore
test-api-smoke-restore: ## Run smoke tests in production mode (for restore validation)
	@$(DOCKER_COMPOSE) exec -T api sh -lc 'npm run test:smoke:restore'

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

.PHONY: up-maildev
up-maildev: ## Start MailDev service in detached mode
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up -d maildev

.PHONY: down-maildev
down-maildev: ## Stop MailDev service
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml stop maildev
