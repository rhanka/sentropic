# {{name}} — Docker-first dev tooling (scaffolded by @sentropic/build-cli).
# Compose project name = the app slug ({{slug}}); ports come from .env.

COMPOSE ?= docker compose

.PHONY: help dev down typecheck build logs

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-12s %s\n", $$1, $$2}'

dev: ## Build + start the backend and UI (Docker Compose)
	$(COMPOSE) up --build

down: ## Stop and remove the app's containers + volumes
	$(COMPOSE) down -v

logs: ## Tail service logs
	$(COMPOSE) logs -f

typecheck: ## Type-check backend + UI
	$(COMPOSE) run --rm --no-deps api sh -lc "npm install --no-audit --no-fund && npm run typecheck"
	$(COMPOSE) run --rm --no-deps ui sh -lc "npm install --no-audit --no-fund && npm run check"

build: ## Build backend + UI for production
	$(COMPOSE) run --rm --no-deps api sh -lc "npm install --no-audit --no-fund && npm run build"
	$(COMPOSE) run --rm --no-deps ui sh -lc "npm install --no-audit --no-fund && npm run build"
