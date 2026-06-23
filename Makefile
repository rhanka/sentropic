SHELL := /bin/bash

-include .env

ENV ?= dev
export COMPOSE_PROJECT_NAME ?= $(ENV)
DOCKER_COMPOSE  ?= docker compose
COMPOSE_RUN_UI  := $(DOCKER_COMPOSE) run --rm ui
COMPOSE_RUN_API := $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm api

export API_PORT ?= 8787
export UI_PORT ?= 5173
export MAILDEV_UI_PORT ?= 1080
export PLAYWRIGHT_DEV_UI_PORT ?= 5174
export VITE_API_BASE_URL ?= http://localhost:$(API_PORT)/api/v1
export VITE_EXTENSION_PROFILE ?= uat
export VITE_EXTENSION_API_BASE_URL ?= http://localhost:$(API_PORT)/api/v1
export VITE_EXTENSION_APP_BASE_URL ?= http://localhost:$(UI_PORT)
export VITE_EXTENSION_WS_BASE_URL ?=
export VITE_EXTENSION_PROFILE_BUILD ?= prod
export VITE_EXTENSION_API_BASE_URL_BUILD ?= https://sentropic.sent-tech.ca/api/v1
export VITE_EXTENSION_APP_BASE_URL_BUILD ?= https://sentropic.sent-tech.ca
export VITE_EXTENSION_WS_BASE_URL_BUILD ?=
export API_BASE_URL ?= http://localhost:$(API_PORT)
export UI_BASE_URL ?= http://localhost:$(UI_PORT)
export MAILDEV_API_URL ?= http://localhost:$(MAILDEV_UI_PORT)
export PLAYWRIGHT_UI_BASE_URL ?=
export PLAYWRIGHT_API_BASE_URL ?=
export PLAYWRIGHT_MAILDEV_API_URL ?=
export WEBAUTHN_ORIGIN ?= http://localhost:$(UI_PORT)
export WEBAUTHN_RP_ID ?= localhost
export CORS_ALLOWED_ORIGINS ?= http://localhost:$(UI_PORT),http://127.0.0.1:$(UI_PORT),http://ui:5173,https://*.sent-tech.ca,chrome-extension://*,vscode-webview://*

export API_VERSION    ?= $(shell echo "package.json package-lock.json packages/llm-mesh/src packages/llm-mesh/package.json packages/llm-mesh/tsconfig.json packages/chat-server/src packages/chat-server/package.json packages/chat-server/tsconfig.json packages/comments/src packages/comments/package.json packages/comments/tsconfig.json api/src api/tests/utils api/package.json api/package-lock.json api/Dockerfile api/tsconfig.json api/tsconfig.build.json" | tr ' ' '\n' | xargs -I '{}' find {} -type f | LC_ALL=C sort | xargs cat | sha1sum - | sed 's/\(......\).*/\1/')
export UI_VERSION     ?= $(shell echo "ui/src ui/package.json ui/package-lock.json ui/Dockerfile ui/tsconfig.json ui/vite.config.ts ui/svelte.config.js ui/postcss.config.cjs ui/tailwind.config.cjs packages/cowork-desktop/bin packages/cowork-desktop/src packages/cowork-desktop/packaging packages/cowork-desktop/package.json packages/cowork-desktop/tsconfig.json packages/cowork-bridge/src packages/cowork-bridge/package.json packages/cowork-bridge/tsconfig.json packages/chat-ui/src packages/chat-ui/package.json packages/chat-ui/tsconfig.json" | tr ' ' '\n' | xargs -I '{}' find {} -type f | LC_ALL=C sort | xargs cat | sha1sum - | sed 's/\(......\).*/\1/')
export E2E_VERSION    ?= $(shell echo "e2e/tests e2e/helpers e2e/global.setup.ts e2e/package.json e2e/package-lock.json e2e/Dockerfile e2e/playwright.config.ts" | tr ' ' '\n' | xargs -I '{}' find {} -type f | LC_ALL=C sort | xargs cat | sha1sum - | sed 's/\(......\).*/\1/')
export API_IMAGE_NAME ?= sentropic-api
export UI_IMAGE_NAME  ?= sentropic-ui
export E2E_IMAGE_NAME ?= sentropic-e2e
export LLM_MESH_NODE_IMAGE ?= node:24-bookworm-slim
export FLOW_NODE_IMAGE ?= node:24-bookworm-slim
# Skills package needs build tools for isolated-vm (native addon).
# The full bookworm image ships python3 + build-essential by default.
export SKILLS_NODE_IMAGE ?= node:24-bookworm

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

.PHONY: docker-stats
docker-stats: ## Show docker stats (ALL=1 for all running containers)
	@set -euo pipefail; \
	if [ "$(ALL)" = "1" ]; then \
		docker stats --no-stream; \
	else \
		ids="$$(docker ps --filter "label=com.docker.compose.project=$(ENV)" --format '{{.ID}}')"; \
		if [ -z "$$ids" ]; then \
			echo "No running containers for compose project '$(ENV)'."; \
		else \
			docker stats --no-stream $$ids; \
		fi; \
	fi

version:
	@echo "API_VERSION: $(API_VERSION)"
	@echo "UI_VERSION: $(UI_VERSION)"

.PHONY: cloc
cloc: ## Count lines of code (whole repo)
	@cloc --vcs=git --not-match-f='(package.*\.json|.*_snapshot\.json)$$'

CONDUCTOR_LANES ?=
CONDUCTOR_LANES_FILE ?=
CONDUCTOR_AUTO_GLOB ?= tmp/feat-* tmp/fix-*

.PHONY: conductor-agent-report agent-conductor-report conductor-agent-status agent-conductor-status agent-conductore-status
conductor-agent-report: ## Conductor report with done/treated % (UAT-excluded), SLOC and heartbeat/stall (configurable lanes)
	@set -euo pipefail; \
	now="$$(date +%s)"; \
	ts="$$(date '+%Y-%m-%d %H:%M:%S %z')"; \
	total_done=0; total_treated=0; total_all=0; \
	lanes=(); \
	if [ -n "$(CONDUCTOR_LANES)" ]; then \
		IFS=';' read -r -a lanes <<< "$(CONDUCTOR_LANES)"; \
	elif [ -n "$(CONDUCTOR_LANES_FILE)" ] && [ -f "$(CONDUCTOR_LANES_FILE)" ]; then \
		while IFS= read -r raw_line; do \
			line="$${raw_line%%#*}"; \
			line="$$(echo "$$line" | xargs)"; \
			if [ -z "$$line" ]; then \
				continue; \
			fi; \
			lanes+=("$$line"); \
		done < "$(CONDUCTOR_LANES_FILE)"; \
	else \
		auto_i=1; \
		for dir in $(CONDUCTOR_AUTO_GLOB); do \
			if [ ! -d "$$dir" ] || [ ! -f "$$dir/BRANCH.md" ]; then \
				continue; \
			fi; \
			lanes+=("$$(printf 'AUTO%02d|-|%s' "$$auto_i" "$$dir")"); \
			auto_i="$$((auto_i + 1))"; \
		done; \
	fi; \
	if [ "$${#lanes[@]}" -eq 0 ]; then \
		echo "No conductor lanes configured."; \
		echo "Use CONDUCTOR_LANES='BR04|B|tmp/feat-workspace-template-catalog;BR05|C|tmp/feat-vscode-plugin-v1;BR06|D|tmp/feat-chrome-upstream-v1'"; \
		echo "or CONDUCTOR_LANES_FILE=<path> (one 'lane|agent|dir' entry per line)."; \
		exit 1; \
	fi; \
	echo "Conductor report ($$ts)"; \
	echo "lane | agent | branch | done | treated | dirty | head | sloc | heartbeat"; \
	echo "-----|-------|--------|------|---------|-------|------|------|----------"; \
	for lane_row in "$${lanes[@]}"; do \
		IFS='|' read -r lane agent dir <<< "$$lane_row"; \
		file="$$dir/BRANCH.md"; \
		branch="$$(git -C "$$dir" branch --show-current 2>/dev/null || echo '?')"; \
		head="$$(git -C "$$dir" rev-parse --short HEAD 2>/dev/null || echo '?')"; \
		dirty="$$(git -C "$$dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"; \
		if [ -f "$$file" ]; then \
			counts="$$(awk '\
				BEGIN { IGNORECASE=1; in_uat=0; done=0; defer=0; total=0 } \
				function is_checkbox(s) { return s ~ /^[[:space:]]*-[[:space:]]*\[( |x|!)\]/ } \
				function is_lot_header(s) { return s ~ /^[[:space:]]*-[[:space:]]*\[( |x|!)\][[:space:]]*\*\*Lot/ } \
				{ \
					line=$$0; \
					if (is_lot_header(line)) { \
						if (line ~ /UAT/) in_uat=1; else in_uat=0; \
					} \
					if (!is_checkbox(line)) next; \
					if (in_uat) next; \
					if (line ~ /UAT/) next; \
					total++; \
					if (line ~ /\[x\]/) done++; \
					else if (line ~ /\[!\]/) defer++; \
				} \
				END { printf "%d|%d|%d", done, defer, total } \
			' "$$file")"; \
			IFS='|' read -r done_count defer_count total_count <<< "$$counts"; \
			mtime="$$(stat -c %Y "$$file" 2>/dev/null || echo 0)"; \
		else \
			done_count=0; defer_count=0; total_count=0; mtime=0; \
		fi; \
		treated_count="$$((done_count + defer_count))"; \
		done_pct="$$(awk -v a="$$done_count" -v b="$$total_count" 'BEGIN{if(b==0){printf "0.0"} else {printf "%.1f",(100*a)/b}}')"; \
		treated_pct="$$(awk -v a="$$treated_count" -v b="$$total_count" 'BEGIN{if(b==0){printf "0.0"} else {printf "%.1f",(100*a)/b}}')"; \
		age="$$((now - mtime))"; \
		if [ "$$age" -gt 60 ]; then hb="STALL($${age}s)"; else hb="ACTIVE($${age}s)"; fi; \
		sloc="$$($(MAKE) --no-print-directory -s -C "$$dir" cloc 2>/dev/null | awk '/^SUM:/{print $$5}' | tail -n1)"; \
		if [ -z "$$sloc" ]; then sloc="n/a"; fi; \
		echo "$$lane | $$agent | $$branch | $$done_count/$$total_count ($$done_pct%) | $$treated_count/$$total_count ($$treated_pct%) | $$dirty | $$head | $$sloc | $$hb"; \
		total_done="$$((total_done + done_count))"; \
		total_treated="$$((total_treated + treated_count))"; \
		total_all="$$((total_all + total_count))"; \
	done; \
	total_done_pct="$$(awk -v a="$$total_done" -v b="$$total_all" 'BEGIN{if(b==0){printf "0.0"} else {printf "%.1f",(100*a)/b}}')"; \
	total_treated_pct="$$(awk -v a="$$total_treated" -v b="$$total_all" 'BEGIN{if(b==0){printf "0.0"} else {printf "%.1f",(100*a)/b}}')"; \
	echo "TOTAL | - | - | $$total_done/$$total_all ($$total_done_pct%) | $$total_treated/$$total_all ($$total_treated_pct%) | - | - | - | -"

agent-conductor-report: conductor-agent-report ## Backward-compatible alias
conductor-agent-status: conductor-agent-report ## Alias used in some workflows
agent-conductor-status: conductor-agent-report ## Alias used in some workflows
agent-conductore-status: conductor-agent-report ## Typo-compatible alias

.PHONY: test-cloc
test-cloc: ## Count lines of code (tests only: api/tests ui/tests e2e/tests)
	@cloc --vcs=git --not-match-f='(package.*\.json|.*_snapshot\.json)$$' api/tests ui/tests e2e/tests

.PHONY: cloc-test
cloc-test: ## (deprecated) Alias for test-cloc
	@$(MAKE) --no-print-directory test-cloc

.PHONY: test-count
test-count: ## Count tests (files + test cases): UI, API, E2E, and package modules
	@TEST_REGEX='(^|[^[:alnum:]_])(test|it)(\.(skip|only|each|concurrent|fails|todo|fixme))*[[:space:]]*[(]'; \
	ui_files=$$(find ui/tests -type f \( -name "*.test.ts" -o -name "*.spec.ts" \) -print | wc -l | tr -d ' '); \
	ui_tests=$$(find ui/tests -type f \( -name "*.test.ts" -o -name "*.spec.ts" \) -print0 | xargs -0r grep -REho "$$TEST_REGEX" | wc -l | tr -d ' '); \
	api_unit_files=$$(find api/tests -type f \( -name "*.test.ts" -o -name "*.spec.ts" \) ! -path "api/tests/ai/*" -print | wc -l | tr -d ' '); \
	api_unit_tests=$$(find api/tests -type f \( -name "*.test.ts" -o -name "*.spec.ts" \) ! -path "api/tests/ai/*" -print0 | xargs -0r grep -REho "$$TEST_REGEX" | wc -l | tr -d ' '); \
	api_ai_files=$$(find api/tests/ai -type f \( -name "*.test.ts" -o -name "*.spec.ts" \) -print 2>/dev/null | wc -l | tr -d ' '); \
	api_ai_tests=$$(find api/tests/ai -type f \( -name "*.test.ts" -o -name "*.spec.ts" \) -print0 2>/dev/null | xargs -0r grep -REho "$$TEST_REGEX" | wc -l | tr -d ' '); \
	e2e_files=$$(find e2e/tests -type f -name "*.spec.ts" ! -path "e2e/tests/fixtures/*" ! -path "e2e/tests/helpers/*" ! -path "e2e/tests/dev/_scratch*" -print | wc -l | tr -d ' '); \
	e2e_tests=$$(find e2e/tests -type f -name "*.spec.ts" ! -path "e2e/tests/fixtures/*" ! -path "e2e/tests/helpers/*" ! -path "e2e/tests/dev/_scratch*" -print0 | xargs -0r grep -REho "$$TEST_REGEX" | wc -l | tr -d ' '); \
	package_files=$$(find packages -path "*/tests/*" -type f \( -name "*.test.ts" -o -name "*.spec.ts" \) -print 2>/dev/null | wc -l | tr -d ' '); \
	package_tests=$$(find packages -path "*/tests/*" -type f \( -name "*.test.ts" -o -name "*.spec.ts" \) -print0 2>/dev/null | xargs -0r grep -REho "$$TEST_REGEX" | wc -l | tr -d ' '); \
	total_files=$$((ui_files + api_unit_files + api_ai_files + e2e_files + package_files)); \
	total_tests=$$((ui_tests + api_unit_tests + api_ai_tests + e2e_tests + package_tests)); \
	echo "📊 Comptage des tests (approx.)"; \
	echo ""; \
	printf "%-28s %10s %10s\n" "Scope" "Fichiers" "Tests"; \
	printf "%-28s %10s %10s\n" "----------------------------" "----------" "----------"; \
	printf "%-28s %10s %10s\n" "UI (unitaires)" "$$ui_files" "$$ui_tests"; \
	printf "%-28s %10s %10s\n" "API (unitaires, sans ai)" "$$api_unit_files" "$$api_unit_tests"; \
	printf "%-28s %10s %10s\n" "API (integration = ai)" "$$api_ai_files" "$$api_ai_tests"; \
	printf "%-28s %10s %10s\n" "E2E (Playwright)" "$$e2e_files" "$$e2e_tests"; \
	printf "%-28s %10s %10s\n" "Packages (modules)" "$$package_files" "$$package_tests"; \
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

.PHONY: commit
commit: ## Create a git commit (MSG="type: message")
	@if [ -z "$(MSG)" ]; then \
		echo "❌ Error: MSG is required (e.g., make commit MSG='docs: update spec')"; \
		exit 1; \
	fi
	@HUSKY=0 git commit -m "$$(printf "%b" "$(MSG)")"

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
	TARGET=production $(DOCKER_COMPOSE) -f docker-compose.yml build --no-cache \
		--build-arg VITE_EXTENSION_PROFILE=$(VITE_EXTENSION_PROFILE_BUILD) \
		--build-arg VITE_EXTENSION_API_BASE_URL=$(VITE_EXTENSION_API_BASE_URL_BUILD) \
		--build-arg VITE_EXTENSION_APP_BASE_URL=$(VITE_EXTENSION_APP_BASE_URL_BUILD) \
		--build-arg VITE_EXTENSION_WS_BASE_URL=$(VITE_EXTENSION_WS_BASE_URL_BUILD) \
		ui

.PHONY: build-ui
build-ui: ## Build the SvelteKit UI (static)
	TARGET=development $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run ui npm run build

.PHONY: build-ext-chrome
build-ext-chrome: ## Build Chrome extension to ui/chrome-ext/dist
	@echo "📦 Installing UI dependencies from lockfile..."
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps ui sh -lc 'npm ci && npm exec svelte-kit sync && npm run build:ext'
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps -e HOST_UID=$$(id -u) -e HOST_GID=$$(id -g) ui sh -lc 'chown -R "$$HOST_UID:$$HOST_GID" /workspace/ui/chrome-ext/dist'
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps ui sh -lc 'test -f /workspace/ui/chrome-ext/dist/manifest.json && test -f /workspace/ui/chrome-ext/dist/content.js && test -f /workspace/ui/chrome-ext/dist/chrome-ext/popup.html && test -f /workspace/ui/chrome-ext/dist/chrome-ext/sidepanel.html'
	@echo "✅ Extension built in ui/chrome-ext/dist"

.PHONY: dev-ext
dev-ext: up-ui ## Watch build Chrome extension
	@echo "👀 Watching Chrome Extension..."
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T ui npm run dev:ext

.PHONY: build-ext-vscode
build-ext-vscode: ## Build VSCode extension package to ui/static/vscode-extension
	@echo "📦 Installing UI dependencies from lockfile..."
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps ui sh -lc 'npm ci && npm exec svelte-kit sync && npm run build:vscode-ext'
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps -e HOST_UID=$$(id -u) -e HOST_GID=$$(id -g) ui sh -lc 'chown -R "$$HOST_UID:$$HOST_GID" /workspace/ui/static/vscode-extension /workspace/ui/vscode-ext/dist'
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps ui sh -lc 'test -f /workspace/ui/static/vscode-extension/sentropic-vscode-extension.vsix && test -f /workspace/ui/vscode-ext/dist/extension.cjs'
	@echo "✅ VSCode extension package built in ui/static/vscode-extension"

.PHONY: dev-ext-vscode
dev-ext-vscode: up-ui ## Watch and rebuild VSCode extension package
	@echo "👀 Watching VSCode Extension..."
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T ui npm run dev:vscode-ext

.PHONY: up-dev-vscode
up-dev-vscode: build-ext-vscode ## Start OpenVSCode mounted dev lane on top of the standard dev stack
	DISABLE_RATE_LIMIT=true $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml --profile vscode up -d openvscode-dev

.PHONY: down-dev-vscode
down-dev-vscode: ## Stop OpenVSCode mounted dev lane
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml --profile vscode stop openvscode-dev >/dev/null 2>&1 || true
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml --profile vscode rm -f openvscode-dev >/dev/null 2>&1 || true

.PHONY: ps-dev-vscode
ps-dev-vscode: ## Show OpenVSCode mounted dev lane services
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml --profile vscode ps openvscode-dev

.PHONY: logs-dev-vscode
logs-dev-vscode: ## Stream OpenVSCode mounted dev lane logs
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml --profile vscode logs -f openvscode-dev

.PHONY: up-dev-playwright
up-dev-playwright: prepare-node-workspace ## Start or reuse the Playwright dev helper on top of the standard dev stack
	@playwright_ui_port="$${PLAYWRIGHT_DEV_UI_PORT:-5174}"; \
	playwright_ui_base_url="$${PLAYWRIGHT_UI_BASE_URL:-http://host.docker.internal:$$playwright_ui_port}"; \
	playwright_api_base_url="$${PLAYWRIGHT_API_BASE_URL:-http://host.docker.internal:$(API_PORT)}"; \
	playwright_maildev_api_url="$${PLAYWRIGHT_MAILDEV_API_URL:-http://maildev:1080}"; \
	CORS_ALLOWED_ORIGINS="http://localhost:$(UI_PORT),http://127.0.0.1:$(UI_PORT),http://ui:5173,$$playwright_ui_base_url,https://*.sent-tech.ca,chrome-extension://*,vscode-webview://*" \
	DISABLE_RATE_LIMIT=true \
	PLAYWRIGHT_DEV_UI_PORT="$$playwright_ui_port" \
	UI_BASE_URL="$$playwright_ui_base_url" \
	API_BASE_URL="$$playwright_api_base_url" \
	MAILDEV_API_URL="$$playwright_maildev_api_url" \
	VITE_API_BASE_URL="$$playwright_api_base_url/api/v1" \
	VITE_EXTENSION_API_BASE_URL="$$playwright_api_base_url/api/v1" \
	VITE_EXTENSION_APP_BASE_URL="$$playwright_ui_base_url" \
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml --profile playwright up -d api ui-playwright-dev playwright-dev

.PHONY: down-dev-playwright
down-dev-playwright: ## Stop Playwright dev helper
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml --profile playwright stop ui-playwright-dev playwright-dev >/dev/null 2>&1 || true
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml --profile playwright rm -f ui-playwright-dev playwright-dev >/dev/null 2>&1 || true

.PHONY: ps-dev-playwright
ps-dev-playwright: ## Show Playwright dev helper
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml --profile playwright ps playwright-dev

.PHONY: logs-dev-playwright
logs-dev-playwright: ## Stream Playwright dev helper logs
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml --profile playwright logs -f playwright-dev

.PHONY: shell-dev-playwright
shell-dev-playwright: up-dev-playwright ## Open a shell inside the Playwright dev helper
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml --profile playwright exec playwright-dev sh

.PHONY: exec-playwright-dev
exec-playwright-dev: up-dev-playwright ## Exec a command in the Playwright dev helper with the live-debug lane bootstrapped
	@if [ -z "$$CMD" ]; then \
	  echo "Usage: make exec-playwright-dev CMD=\"<command>\" API_PORT=<api> UI_PORT=<ui> MAILDEV_UI_PORT=<maildev> REGISTRY=local ENV=dev"; \
	  exit 2; \
	fi
	@ui_base_url="$${PLAYWRIGHT_UI_BASE_URL:-http://host.docker.internal:$${PLAYWRIGHT_DEV_UI_PORT:-5174}}"; \
	api_base_url="$${PLAYWRIGHT_API_BASE_URL:-http://host.docker.internal:$(API_PORT)}"; \
	maildev_api_url="$${PLAYWRIGHT_MAILDEV_API_URL:-http://maildev:1080}"; \
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml --profile playwright exec -T \
	  -e UI_BASE_URL="$$ui_base_url" \
	  -e API_BASE_URL="$$api_base_url" \
	  -e MAILDEV_API_URL="$$maildev_api_url" \
	  playwright-dev sh -lc "$$CMD"

.PHONY: record-dev-playwright-auth
record-dev-playwright-auth: up-dev-playwright ## Record a reusable Playwright storageState against ENV=dev
	@ui_base_url="$${PLAYWRIGHT_UI_BASE_URL:-http://host.docker.internal:$${PLAYWRIGHT_DEV_UI_PORT:-5174}}"; \
	api_base_url="$${PLAYWRIGHT_API_BASE_URL:-http://host.docker.internal:$(API_PORT)}"; \
	maildev_api_url="$${PLAYWRIGHT_MAILDEV_API_URL:-http://maildev:1080}"; \
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml --profile playwright exec -T \
	  -e UI_BASE_URL="$$ui_base_url" \
	  -e API_BASE_URL="$$api_base_url" \
	  -e MAILDEV_API_URL="$$maildev_api_url" \
	  playwright-dev sh -lc ' \
	  email="$${DEV_PLAYWRIGHT_AUTH_EMAIL:-admin@sent-tech.ca}"; \
	  echo "▶ Recording Playwright dev auth for $$email"; \
	  npx playwright test --config playwright.dev.config.ts tests/dev/00-record-auth.spec.ts --workers=1 --retries=0 --reporter=list --grep "$$email"; \
	'

.PHONY: test-e2e-dev
test-e2e-dev: up-dev-playwright ## Run scoped Playwright against ENV=dev without seed/reset/global setup
	@if [ -z "$(E2E_SPEC)" ]; then \
	  echo "❌ E2E_SPEC is required (example: tests/dev/01-chat-bootstrap-reload.spec.ts)"; \
	  exit 2; \
	fi
	@ui_base_url="$${PLAYWRIGHT_UI_BASE_URL:-http://host.docker.internal:$${PLAYWRIGHT_DEV_UI_PORT:-5174}}"; \
	api_base_url="$${PLAYWRIGHT_API_BASE_URL:-http://host.docker.internal:$(API_PORT)}"; \
	maildev_api_url="$${PLAYWRIGHT_MAILDEV_API_URL:-http://maildev:1080}"; \
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml --profile playwright exec -T \
	  -e UI_BASE_URL="$$ui_base_url" \
	  -e API_BASE_URL="$$api_base_url" \
	  -e MAILDEV_API_URL="$$maildev_api_url" \
	  playwright-dev sh -lc ' \
	  test -f /app/.auth/dev-state.json || { \
	    echo "❌ Missing /app/.auth/dev-state.json. Record a manual dev storageState before using test-e2e-dev."; \
	    exit 2; \
	  }; \
	  workers="$${WORKERS:-1}"; \
	  retries="$${RETRIES:-0}"; \
	  max_fail="$${MAX_FAILURES:-}"; \
	  extra=""; \
	  if [ -n "$$max_fail" ]; then extra="--max-failures=$$max_fail"; fi; \
	  spec_path="$(E2E_SPEC)"; \
	  spec_path="$${spec_path#e2e/}"; \
	  echo "▶ Running scoped Playwright (dev): $$spec_path (workers=$$workers retries=$$retries $${extra:-})"; \
	  npx playwright test --config playwright.dev.config.ts "$$spec_path" --workers="$$workers" --retries="$$retries" $$extra; \
	'

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

.PHONY: lock-root
lock-root: ## Update root package-lock.json using Node container (workspace root)
	@echo "🔒 Updating root package-lock.json..."
	docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-v "$$(pwd):/workspace" \
		-w /workspace \
		node:24-alpine \
		sh -lc "npm install --package-lock-only --workspaces --include-workspace-root"

.PHONY: lock-e2e
lock-e2e: ## Update e2e package-lock.json using Node container (no compose service)
	@echo "🔒 Updating e2e package-lock.json..."
	docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-v "$$(pwd):/workspace" \
		-w /workspace/e2e \
		node:24-slim \
		sh -lc "npm install --legacy-peer-deps --package-lock-only --ignore-scripts --no-audit --no-fund"

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


.PHONY: typecheck
typecheck: typecheck-ui typecheck-api ## Run all type checks

.PHONY: typecheck-ui
typecheck-ui: up-ui ## Run UI type checks
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T ui npm run check

.PHONY: typecheck-api
typecheck-api: prepare-node-workspace ## Run API type checks
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps api npm run typecheck

.PHONY: typecheck-llm-mesh
typecheck-llm-mesh: ## Run @sentropic/llm-mesh type checks
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/llm-mesh $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node >/dev/null; "$$tool_dir/node_modules/.bin/tsc" --noEmit -p tsconfig.json'

.PHONY: typecheck-skills
typecheck-skills: ## Run @sentropic/skills type checks
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/skills $(SKILLS_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node gray-matter@4.0.3 zod@3.23.8 isolated-vm@6.1.2 docx@9.5.1 pptxgenjs@4.0.1 >/dev/null; ln -s "$$tool_dir/node_modules" node_modules; trap "rm -f node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" --noEmit -p tsconfig.json'

.PHONY: build-llm-mesh
build-llm-mesh: ## Build @sentropic/llm-mesh dist package
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/llm-mesh $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist'
	@docker run --rm -u "$$(id -u):$$(id -g)" -v "$(CURDIR):/workspace" -w /workspace/packages/llm-mesh $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node >/dev/null; "$$tool_dir/node_modules/.bin/tsc" -p tsconfig.json'

# BR-LB-EX1 — @sentropic/llm-gateway (WP16 Layer-B) CI wiring (owner-approved 2026-06-22).
# Mirrors the sibling-package symlink pattern used by typecheck-auth-hono/test-auth-hono
# (which symlinks @sentropic/oauth-verify): the gateway consumes @sentropic/llm-mesh, so it
# needs the built llm-mesh dist symlinked in + hono. typecheck covers src AND tests.
.PHONY: typecheck-llm-gateway
typecheck-llm-gateway: build-llm-mesh ## Run @sentropic/llm-gateway type checks
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/llm-gateway $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/llm-gateway $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; rm -rf node_modules; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node hono@4.10.7 vitest@4.0.18 >/dev/null; mkdir -p node_modules/@sentropic node_modules/@types; ln -sfn "$$tool_dir/node_modules/hono" node_modules/hono; ln -sfn "$$tool_dir/node_modules/vitest" node_modules/vitest; ln -sfn "$$tool_dir/node_modules/@types/node" node_modules/@types/node; ln -sfn /workspace/packages/llm-mesh node_modules/@sentropic/llm-mesh; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" --noEmit -p tsconfig.json; "$$tool_dir/node_modules/.bin/tsc" --noEmit -p tsconfig.test.json'
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/llm-gateway $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'

.PHONY: build-llm-gateway
build-llm-gateway: build-llm-mesh ## Build @sentropic/llm-gateway dist package
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/llm-gateway $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/llm-gateway $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; rm -rf node_modules; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node hono@4.10.7 >/dev/null; mkdir -p node_modules/@sentropic node_modules/@types; ln -sfn "$$tool_dir/node_modules/hono" node_modules/hono; ln -sfn "$$tool_dir/node_modules/@types/node" node_modules/@types/node; ln -sfn /workspace/packages/llm-mesh node_modules/@sentropic/llm-mesh; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" -p tsconfig.json'
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/llm-gateway $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'

.PHONY: pack-llm-gateway
pack-llm-gateway: build-llm-gateway ## Validate @sentropic/llm-gateway npm package contents without publishing
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/llm-gateway $(LLM_MESH_NODE_IMAGE) sh -lc 'npm pack --dry-run'

.PHONY: typecheck-flow
typecheck-flow: ## Run @sentropic/flow type checks
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/flow $(FLOW_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node >/dev/null; "$$tool_dir/node_modules/.bin/tsc" --noEmit -p tsconfig.json'

.PHONY: build-flow
build-flow: ## Build @sentropic/flow dist package
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/flow $(FLOW_NODE_IMAGE) sh -lc 'rm -rf dist'
	@docker run --rm -u "$$(id -u):$$(id -g)" -v "$(CURDIR):/workspace" -w /workspace/packages/flow $(FLOW_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node >/dev/null; "$$tool_dir/node_modules/.bin/tsc" -p tsconfig.json'

.PHONY: pack-llm-mesh
pack-llm-mesh: build-llm-mesh ## Validate @sentropic/llm-mesh npm package contents without publishing
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/llm-mesh $(LLM_MESH_NODE_IMAGE) sh -lc 'npm pack --dry-run'

.PHONY: publish-llm-mesh
publish-llm-mesh: build-llm-mesh ## Publish @sentropic/llm-mesh from CI OIDC trusted publishing
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-e GITHUB_ACTIONS \
		-e GITHUB_REPOSITORY \
		-e GITHUB_REF \
		-e GITHUB_SHA \
		-e GITHUB_EVENT_NAME \
		-e GITHUB_RUN_ID \
		-e GITHUB_RUN_ATTEMPT \
		-e GITHUB_SERVER_URL \
		-e GITHUB_REPOSITORY_ID \
		-e GITHUB_REPOSITORY_OWNER_ID \
		-e GITHUB_WORKFLOW \
		-e GITHUB_WORKFLOW_REF \
		-e GITHUB_WORKFLOW_SHA \
		-e ACTIONS_ID_TOKEN_REQUEST_URL \
		-e ACTIONS_ID_TOKEN_REQUEST_TOKEN \
		-v "$(CURDIR):/workspace" \
		-w /workspace/packages/llm-mesh \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/llm-mesh@"$$version" version >/dev/null 2>&1; then echo "@sentropic/llm-mesh@$$version already exists; skipping publish"; else npm publish --access public; fi'

NPM_TOKEN_FILE ?= /tmp/sentropic-npm-token

.PHONY: publish-llm-mesh-token
publish-llm-mesh-token: build-llm-mesh ## Publish @sentropic/llm-mesh using a token read from NPM_TOKEN_FILE (bootstrap only; prefer OIDC publish-llm-mesh in CI)
	@test -s "$(NPM_TOKEN_FILE)" || { echo "ERROR: $(NPM_TOKEN_FILE) is missing or empty"; exit 1; }
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" \
		-v "$(NPM_TOKEN_FILE):/run/npm-token:ro" \
		-w /workspace/packages/llm-mesh \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; token="$$(cat /run/npm-token)"; printf "//registry.npmjs.org/:_authToken=%s\n" "$$token" > /tmp/.npmrc; export NPM_CONFIG_USERCONFIG=/tmp/.npmrc; npm whoami --registry=https://registry.npmjs.org; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/llm-mesh@"$$version" version >/dev/null 2>&1; then echo "@sentropic/llm-mesh@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: typecheck-chat-ui
typecheck-chat-ui: ## Run @sentropic/chat-ui type checks
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/chat-ui $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node svelte@5.55.7 >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/svelte" node_modules/svelte; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" --noEmit -p tsconfig.json'

# BR-PKG-EX1: build-chat-ui now runs svelte-package (preprocessed dist) instead of bare tsc.
# Rationale: produce a consumable npm artifact — external consumers get .svelte with TS stripped +
# styles processed, no more "postcss Unknown word" errors. Impact: build target only.
# Rollback: revert this target to the original tsc invocation.
.PHONY: build-chat-ui
build-chat-ui: ## Build @sentropic/chat-ui preprocessed dist via svelte-package (BR-PKG-EX1)
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/chat-ui $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/chat-ui $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund "@sveltejs/package@2.3.9" "svelte-preprocess@6.0.3" svelte@5.55.7 typescript@5.4.5 @types/node >/dev/null; mkdir -p node_modules/@sveltejs; ln -sfn "$$tool_dir/node_modules/svelte" node_modules/svelte; ln -sfn "$$tool_dir/node_modules/@sveltejs/package" node_modules/@sveltejs/package; ln -sfn "$$tool_dir/node_modules/svelte-preprocess" node_modules/svelte-preprocess; trap "cp /tmp/svelte.config.orig.js svelte.config.js; rm -rf node_modules" EXIT; cp svelte.config.js /tmp/svelte.config.orig.js; printf "import sveltePreprocess from '\''svelte-preprocess'\'';\nexport default { preprocess: sveltePreprocess({ typescript: true }) };\n" > svelte.config.js; "$$tool_dir/node_modules/.bin/svelte-package" -i src -o dist; find dist -name "*.svelte" -exec sed -i "s/<script lang=\"ts\">/<script>/g; s/<script lang=.ts.>/<script>/g" {} +'

# BR-PKG-EX1 (Makefile exception): pack-chat-ui transiently rewrites package.json to dist-form,
# runs npm pack --dry-run, then restores the src-form package.json.
# The committed repo package.json always stays src-form (exports -> ./src/...).
.PHONY: pack-chat-ui
pack-chat-ui: build-chat-ui ## Validate @sentropic/chat-ui npm package contents without publishing (dist-form tarball via transient package.json rewrite — BR-PKG-EX1)
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/chat-ui $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; echo "--- dist sanity check ---"; if grep -rl "lang=\"ts\"" dist/components/*.svelte 2>/dev/null | grep -q .; then echo "FAIL: dist .svelte files still contain lang=ts -- svelte-package did not preprocess"; exit 1; fi; test -f dist/index.js || { echo "FAIL: dist/index.js missing"; exit 1; }; echo "PASS: no lang=ts in dist/components/*.svelte + dist/index.js exists"'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/chat-ui $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; cp package.json /tmp/pkg-src-backup.json; trap "cp /tmp/pkg-src-backup.json package.json" EXIT; node scripts/make-publish-pkgjson.mjs --write; echo "--- packed package.json exports (dist-form) ---"; node -e "const p=require(\"./package.json\"); console.log(JSON.stringify({main:p.main,types:p.types,files:p.files,exports_root:p.exports[\".\"]},null,2))"; npm pack --dry-run'

.PHONY: typecheck-auth-hono
typecheck-auth-hono: build-oauth-verify ## Run @sentropic/auth-hono type checks
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/auth-hono $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/auth-hono $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; rm -rf node_modules; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node hono@4.10.7 @hono/zod-validator@0.7.5 zod@3.25.76 jose@5.10.0 @simplewebauthn/server@13.2.2 >/dev/null; mkdir -p node_modules/@hono node_modules/@simplewebauthn node_modules/@sentropic; ln -sfn "$$tool_dir/node_modules/hono" node_modules/hono; ln -sfn "$$tool_dir/node_modules/@hono/zod-validator" node_modules/@hono/zod-validator; ln -sfn "$$tool_dir/node_modules/zod" node_modules/zod; ln -sfn "$$tool_dir/node_modules/jose" node_modules/jose; ln -sfn "$$tool_dir/node_modules/@simplewebauthn/server" node_modules/@simplewebauthn/server; ln -sfn /workspace/packages/oauth-verify node_modules/@sentropic/oauth-verify; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" --noEmit -p tsconfig.json'
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/auth-hono $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'

.PHONY: build-auth-hono
build-auth-hono: build-oauth-verify ## Build @sentropic/auth-hono dist package
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/auth-hono $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/auth-hono $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; rm -rf node_modules; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node hono@4.10.7 @hono/zod-validator@0.7.5 zod@3.25.76 jose@5.10.0 @simplewebauthn/server@13.2.2 >/dev/null; mkdir -p node_modules/@hono node_modules/@simplewebauthn node_modules/@sentropic; ln -sfn "$$tool_dir/node_modules/hono" node_modules/hono; ln -sfn "$$tool_dir/node_modules/@hono/zod-validator" node_modules/@hono/zod-validator; ln -sfn "$$tool_dir/node_modules/zod" node_modules/zod; ln -sfn "$$tool_dir/node_modules/jose" node_modules/jose; ln -sfn "$$tool_dir/node_modules/@simplewebauthn/server" node_modules/@simplewebauthn/server; ln -sfn /workspace/packages/oauth-verify node_modules/@sentropic/oauth-verify; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" -p tsconfig.json'
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/auth-hono $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'

.PHONY: pack-auth-hono
pack-auth-hono: build-auth-hono ## Validate @sentropic/auth-hono npm package contents without publishing
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/auth-hono $(LLM_MESH_NODE_IMAGE) sh -lc 'npm pack --dry-run'

.PHONY: publish-auth-hono
publish-auth-hono: build-auth-hono ## Publish @sentropic/auth-hono from CI OIDC trusted publishing
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-e GITHUB_ACTIONS \
		-e GITHUB_REPOSITORY \
		-e GITHUB_REF \
		-e GITHUB_SHA \
		-e GITHUB_EVENT_NAME \
		-e GITHUB_RUN_ID \
		-e GITHUB_RUN_ATTEMPT \
		-e GITHUB_SERVER_URL \
		-e GITHUB_REPOSITORY_ID \
		-e GITHUB_REPOSITORY_OWNER_ID \
		-e GITHUB_WORKFLOW \
		-e GITHUB_WORKFLOW_REF \
		-e GITHUB_WORKFLOW_SHA \
		-e ACTIONS_ID_TOKEN_REQUEST_URL \
		-e ACTIONS_ID_TOKEN_REQUEST_TOKEN \
		-v "$(CURDIR):/workspace" \
		-w /workspace/packages/auth-hono \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/auth-hono@"$$version" version >/dev/null 2>&1; then echo "@sentropic/auth-hono@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-auth-hono-token
publish-auth-hono-token: build-auth-hono ## Publish @sentropic/auth-hono using NPM_TOKEN_FILE (bootstrap only; prefer OIDC publish-auth-hono in CI)
	@test -s "$(NPM_TOKEN_FILE)" || { echo "ERROR: $(NPM_TOKEN_FILE) is missing or empty"; exit 1; }
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" \
		-v "$(NPM_TOKEN_FILE):/run/npm-token:ro" \
		-w /workspace/packages/auth-hono \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; token="$$(cat /run/npm-token)"; printf "//registry.npmjs.org/:_authToken=%s\n" "$$token" > /tmp/.npmrc; export NPM_CONFIG_USERCONFIG=/tmp/.npmrc; npm whoami --registry=https://registry.npmjs.org; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/auth-hono@"$$version" version >/dev/null 2>&1; then echo "@sentropic/auth-hono@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: typecheck-auth-client
typecheck-auth-client: ## Run @sentropic/auth-client type checks
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/auth-client $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/auth-client $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; rm -rf node_modules; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node jose@5.10.0 >/dev/null; mkdir -p node_modules/@types; ln -sfn "$$tool_dir/node_modules/jose" node_modules/jose; ln -sfn "$$tool_dir/node_modules/@types/node" node_modules/@types/node; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" --noEmit -p tsconfig.json'
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/auth-client $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'

.PHONY: build-auth-client
build-auth-client: ## Build @sentropic/auth-client dist package
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/auth-client $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/auth-client $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; rm -rf node_modules; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node jose@5.10.0 >/dev/null; mkdir -p node_modules/@types; ln -sfn "$$tool_dir/node_modules/jose" node_modules/jose; ln -sfn "$$tool_dir/node_modules/@types/node" node_modules/@types/node; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" -p tsconfig.json'
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/auth-client $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'

.PHONY: pack-auth-client
pack-auth-client: build-auth-client ## Validate @sentropic/auth-client npm package contents without publishing
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/auth-client $(LLM_MESH_NODE_IMAGE) sh -lc 'npm pack --dry-run'

.PHONY: publish-auth-client
publish-auth-client: build-auth-client ## Publish @sentropic/auth-client from CI OIDC trusted publishing
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-e GITHUB_ACTIONS \
		-e GITHUB_REPOSITORY \
		-e GITHUB_REF \
		-e GITHUB_SHA \
		-e GITHUB_EVENT_NAME \
		-e GITHUB_RUN_ID \
		-e GITHUB_RUN_ATTEMPT \
		-e GITHUB_SERVER_URL \
		-e GITHUB_REPOSITORY_ID \
		-e GITHUB_REPOSITORY_OWNER_ID \
		-e GITHUB_WORKFLOW \
		-e GITHUB_WORKFLOW_REF \
		-e GITHUB_WORKFLOW_SHA \
		-e ACTIONS_ID_TOKEN_REQUEST_URL \
		-e ACTIONS_ID_TOKEN_REQUEST_TOKEN \
		-v "$(CURDIR):/workspace" \
		-w /workspace/packages/auth-client \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/auth-client@"$$version" version >/dev/null 2>&1; then echo "@sentropic/auth-client@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-auth-client-token
publish-auth-client-token: build-auth-client ## Publish @sentropic/auth-client using NPM_TOKEN_FILE (bootstrap only; prefer OIDC publish-auth-client in CI)
	@test -s "$(NPM_TOKEN_FILE)" || { echo "ERROR: $(NPM_TOKEN_FILE) is missing or empty"; exit 1; }
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" \
		-v "$(NPM_TOKEN_FILE):/run/npm-token:ro" \
		-w /workspace/packages/auth-client \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; token="$$(cat /run/npm-token)"; printf "//registry.npmjs.org/:_authToken=%s\n" "$$token" > /tmp/.npmrc; export NPM_CONFIG_USERCONFIG=/tmp/.npmrc; npm whoami --registry=https://registry.npmjs.org; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/auth-client@"$$version" version >/dev/null 2>&1; then echo "@sentropic/auth-client@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: typecheck-oauth-verify
typecheck-oauth-verify: ## Run @sentropic/oauth-verify type checks
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/oauth-verify $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/oauth-verify $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; rm -rf node_modules; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node jose@5.10.0 >/dev/null; mkdir -p node_modules/@types; ln -sfn "$$tool_dir/node_modules/jose" node_modules/jose; ln -sfn "$$tool_dir/node_modules/@types/node" node_modules/@types/node; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" --noEmit -p tsconfig.json'
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/oauth-verify $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'

.PHONY: build-oauth-verify
build-oauth-verify: ## Build @sentropic/oauth-verify dist package
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/oauth-verify $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/oauth-verify $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; rm -rf node_modules; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node jose@5.10.0 >/dev/null; mkdir -p node_modules/@types; ln -sfn "$$tool_dir/node_modules/jose" node_modules/jose; ln -sfn "$$tool_dir/node_modules/@types/node" node_modules/@types/node; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" -p tsconfig.json'
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/oauth-verify $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'

.PHONY: test-oauth-verify
test-oauth-verify: ## Run @sentropic/oauth-verify tests
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/oauth-verify $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/oauth-verify $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; scope="$(SCOPE)"; scope="$${scope#packages/oauth-verify/}"; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node jose@5.10.0 >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/jose" node_modules/jose; ln -sfn "$$tool_dir/node_modules/vitest" node_modules/vitest; trap "rm -rf node_modules" EXIT; if [ -n "$$scope" ]; then "$$tool_dir/node_modules/.bin/vitest" run "$$scope" --environment node; else "$$tool_dir/node_modules/.bin/vitest" run tests --environment node; fi'
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/oauth-verify $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'

.PHONY: pack-oauth-verify
pack-oauth-verify: build-oauth-verify ## Validate @sentropic/oauth-verify npm package contents without publishing
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/oauth-verify $(LLM_MESH_NODE_IMAGE) sh -lc 'npm pack --dry-run'

.PHONY: publish-oauth-verify
publish-oauth-verify: build-oauth-verify ## Publish @sentropic/oauth-verify from CI OIDC trusted publishing
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-e GITHUB_ACTIONS \
		-e GITHUB_REPOSITORY \
		-e GITHUB_REF \
		-e GITHUB_SHA \
		-e GITHUB_EVENT_NAME \
		-e GITHUB_RUN_ID \
		-e GITHUB_RUN_ATTEMPT \
		-e GITHUB_SERVER_URL \
		-e GITHUB_REPOSITORY_ID \
		-e GITHUB_REPOSITORY_OWNER_ID \
		-e GITHUB_WORKFLOW \
		-e GITHUB_WORKFLOW_REF \
		-e GITHUB_WORKFLOW_SHA \
		-e ACTIONS_ID_TOKEN_REQUEST_URL \
		-e ACTIONS_ID_TOKEN_REQUEST_TOKEN \
		-v "$(CURDIR):/workspace" \
		-w /workspace/packages/oauth-verify \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/oauth-verify@"$$version" version >/dev/null 2>&1; then echo "@sentropic/oauth-verify@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-oauth-verify-token
publish-oauth-verify-token: build-oauth-verify ## Publish @sentropic/oauth-verify using NPM_TOKEN_FILE (bootstrap only; prefer OIDC publish-oauth-verify in CI)
	@test -s "$(NPM_TOKEN_FILE)" || { echo "ERROR: $(NPM_TOKEN_FILE) is missing or empty"; exit 1; }
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" \
		-v "$(NPM_TOKEN_FILE):/run/npm-token:ro" \
		-w /workspace/packages/oauth-verify \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; token="$$(cat /run/npm-token)"; printf "//registry.npmjs.org/:_authToken=%s\n" "$$token" > /tmp/.npmrc; export NPM_CONFIG_USERCONFIG=/tmp/.npmrc; npm whoami --registry=https://registry.npmjs.org; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/oauth-verify@"$$version" version >/dev/null 2>&1; then echo "@sentropic/oauth-verify@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: typecheck-mcp-auth
typecheck-mcp-auth: build-oauth-verify ## Run @sentropic/mcp-auth type checks
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/mcp-auth $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/mcp-auth $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; rm -rf node_modules; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node hono@4.10.7 jose@5.10.0 >/dev/null; mkdir -p node_modules/@types node_modules/@sentropic; ln -sfn "$$tool_dir/node_modules/hono" node_modules/hono; ln -sfn "$$tool_dir/node_modules/jose" node_modules/jose; ln -sfn "$$tool_dir/node_modules/@types/node" node_modules/@types/node; ln -sfn /workspace/packages/oauth-verify node_modules/@sentropic/oauth-verify; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" --noEmit -p tsconfig.json'
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/mcp-auth $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'

.PHONY: build-mcp-auth
build-mcp-auth: build-oauth-verify ## Build @sentropic/mcp-auth dist package
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/mcp-auth $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/mcp-auth $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; rm -rf node_modules; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node hono@4.10.7 jose@5.10.0 >/dev/null; mkdir -p node_modules/@types node_modules/@sentropic; ln -sfn "$$tool_dir/node_modules/hono" node_modules/hono; ln -sfn "$$tool_dir/node_modules/jose" node_modules/jose; ln -sfn "$$tool_dir/node_modules/@types/node" node_modules/@types/node; ln -sfn /workspace/packages/oauth-verify node_modules/@sentropic/oauth-verify; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" -p tsconfig.json'
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/mcp-auth $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'

.PHONY: test-mcp-auth
test-mcp-auth: build-oauth-verify ## Run @sentropic/mcp-auth tests
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/mcp-auth $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/mcp-auth $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; scope="$(SCOPE)"; scope="$${scope#packages/mcp-auth/}"; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node hono@4.10.7 jose@5.10.0 >/dev/null; mkdir -p node_modules @types node_modules/@sentropic; ln -sfn "$$tool_dir/node_modules/hono" node_modules/hono; ln -sfn "$$tool_dir/node_modules/jose" node_modules/jose; ln -sfn "$$tool_dir/node_modules/vitest" node_modules/vitest; ln -sfn /workspace/packages/oauth-verify node_modules/@sentropic/oauth-verify; trap "rm -rf node_modules" EXIT; if [ -n "$$scope" ]; then "$$tool_dir/node_modules/.bin/vitest" run "$$scope" --environment node; else "$$tool_dir/node_modules/.bin/vitest" run tests --environment node; fi'
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/mcp-auth $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'

.PHONY: pack-mcp-auth
pack-mcp-auth: build-mcp-auth ## Validate @sentropic/mcp-auth npm package contents without publishing
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/mcp-auth $(LLM_MESH_NODE_IMAGE) sh -lc 'npm pack --dry-run'

.PHONY: publish-mcp-auth
publish-mcp-auth: build-mcp-auth ## Publish @sentropic/mcp-auth from CI OIDC trusted publishing
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-e GITHUB_ACTIONS \
		-e GITHUB_REPOSITORY \
		-e GITHUB_REF \
		-e GITHUB_SHA \
		-e GITHUB_EVENT_NAME \
		-e GITHUB_RUN_ID \
		-e GITHUB_RUN_ATTEMPT \
		-e GITHUB_SERVER_URL \
		-e GITHUB_REPOSITORY_ID \
		-e GITHUB_REPOSITORY_OWNER_ID \
		-e GITHUB_WORKFLOW \
		-e GITHUB_WORKFLOW_REF \
		-e GITHUB_WORKFLOW_SHA \
		-e ACTIONS_ID_TOKEN_REQUEST_URL \
		-e ACTIONS_ID_TOKEN_REQUEST_TOKEN \
		-v "$(CURDIR):/workspace" \
		-w /workspace/packages/mcp-auth \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/mcp-auth@"$$version" version >/dev/null 2>&1; then echo "@sentropic/mcp-auth@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-mcp-auth-token
publish-mcp-auth-token: build-mcp-auth ## Publish @sentropic/mcp-auth using NPM_TOKEN_FILE (bootstrap only; prefer OIDC publish-mcp-auth in CI)
	@test -s "$(NPM_TOKEN_FILE)" || { echo "ERROR: $(NPM_TOKEN_FILE) is missing or empty"; exit 1; }
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" \
		-v "$(NPM_TOKEN_FILE):/run/npm-token:ro" \
		-w /workspace/packages/mcp-auth \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; token="$$(cat /run/npm-token)"; printf "//registry.npmjs.org/:_authToken=%s\n" "$$token" > /tmp/.npmrc; export NPM_CONFIG_USERCONFIG=/tmp/.npmrc; npm whoami --registry=https://registry.npmjs.org; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/mcp-auth@"$$version" version >/dev/null 2>&1; then echo "@sentropic/mcp-auth@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: typecheck-auth-ui
typecheck-auth-ui: ## Run @sentropic/auth-ui type checks
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/auth-ui $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; rm -rf node_modules; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node @simplewebauthn/browser@13.2.2 svelte@5.55.7 >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/@simplewebauthn" node_modules/@simplewebauthn; ln -sfn "$$tool_dir/node_modules/svelte" node_modules/svelte; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" --noEmit -p tsconfig.json'

.PHONY: build-auth-ui
build-auth-ui: ## Build @sentropic/auth-ui dist package
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/auth-ui $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/auth-ui $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; rm -rf node_modules; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node @simplewebauthn/browser@13.2.2 svelte@5.55.7 >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/@simplewebauthn" node_modules/@simplewebauthn; ln -sfn "$$tool_dir/node_modules/svelte" node_modules/svelte; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" -p tsconfig.json'

.PHONY: pack-auth-ui
pack-auth-ui: build-auth-ui ## Validate @sentropic/auth-ui npm package contents without publishing
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/auth-ui $(LLM_MESH_NODE_IMAGE) sh -lc 'npm pack --dry-run'

.PHONY: publish-auth-ui
publish-auth-ui: build-auth-ui ## Publish @sentropic/auth-ui from CI OIDC trusted publishing
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-e GITHUB_ACTIONS \
		-e GITHUB_REPOSITORY \
		-e GITHUB_REF \
		-e GITHUB_SHA \
		-e GITHUB_EVENT_NAME \
		-e GITHUB_RUN_ID \
		-e GITHUB_RUN_ATTEMPT \
		-e GITHUB_SERVER_URL \
		-e GITHUB_REPOSITORY_ID \
		-e GITHUB_REPOSITORY_OWNER_ID \
		-e GITHUB_WORKFLOW \
		-e GITHUB_WORKFLOW_REF \
		-e GITHUB_WORKFLOW_SHA \
		-e ACTIONS_ID_TOKEN_REQUEST_URL \
		-e ACTIONS_ID_TOKEN_REQUEST_TOKEN \
		-v "$(CURDIR):/workspace" \
		-w /workspace/packages/auth-ui \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/auth-ui@"$$version" version >/dev/null 2>&1; then echo "@sentropic/auth-ui@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-auth-ui-token
publish-auth-ui-token: build-auth-ui ## Publish @sentropic/auth-ui using NPM_TOKEN_FILE (bootstrap only; prefer OIDC publish-auth-ui in CI)
	@test -s "$(NPM_TOKEN_FILE)" || { echo "ERROR: $(NPM_TOKEN_FILE) is missing or empty"; exit 1; }
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" \
		-v "$(NPM_TOKEN_FILE):/run/npm-token:ro" \
		-w /workspace/packages/auth-ui \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; token="$$(cat /run/npm-token)"; printf "//registry.npmjs.org/:_authToken=%s\n" "$$token" > /tmp/.npmrc; export NPM_CONFIG_USERCONFIG=/tmp/.npmrc; npm whoami --registry=https://registry.npmjs.org; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/auth-ui@"$$version" version >/dev/null 2>&1; then echo "@sentropic/auth-ui@$$version already exists; skipping publish"; else npm publish --access public; fi'

# BR-PKG-EX1 (Makefile exception): publish-chat-ui transiently rewrites package.json to dist-form,
# runs npm publish, then restores the src-form package.json.
# The committed repo package.json always stays src-form (exports -> ./src/...).
.PHONY: publish-chat-ui
publish-chat-ui: build-chat-ui ## Publish @sentropic/chat-ui from CI OIDC trusted publishing (dist-form tarball via transient package.json rewrite — BR-PKG-EX1)
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-e GITHUB_ACTIONS \
		-e GITHUB_REPOSITORY \
		-e GITHUB_REF \
		-e GITHUB_SHA \
		-e GITHUB_EVENT_NAME \
		-e GITHUB_RUN_ID \
		-e GITHUB_RUN_ATTEMPT \
		-e GITHUB_SERVER_URL \
		-e GITHUB_REPOSITORY_ID \
		-e GITHUB_REPOSITORY_OWNER_ID \
		-e GITHUB_WORKFLOW \
		-e GITHUB_WORKFLOW_REF \
		-e GITHUB_WORKFLOW_SHA \
		-e ACTIONS_ID_TOKEN_REQUEST_URL \
		-e ACTIONS_ID_TOKEN_REQUEST_TOKEN \
		-v "$(CURDIR):/workspace" \
		-w /workspace/packages/chat-ui \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; cp package.json /tmp/pkg-src-backup.json; trap "cp /tmp/pkg-src-backup.json package.json" EXIT; node scripts/make-publish-pkgjson.mjs --write; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/chat-ui@"$$version" version >/dev/null 2>&1; then echo "@sentropic/chat-ui@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-chat-ui-token
publish-chat-ui-token: build-chat-ui ## Publish @sentropic/chat-ui using a token read from NPM_TOKEN_FILE (bootstrap only; prefer OIDC publish-chat-ui in CI)
	@test -s "$(NPM_TOKEN_FILE)" || { echo "ERROR: $(NPM_TOKEN_FILE) is missing or empty"; exit 1; }
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" \
		-v "$(NPM_TOKEN_FILE):/run/npm-token:ro" \
		-w /workspace/packages/chat-ui \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; token="$$(cat /run/npm-token)"; printf "//registry.npmjs.org/:_authToken=%s\n" "$$token" > /tmp/.npmrc; export NPM_CONFIG_USERCONFIG=/tmp/.npmrc; npm whoami --registry=https://registry.npmjs.org; cp package.json /tmp/pkg-src-backup.json; trap "cp /tmp/pkg-src-backup.json package.json" EXIT; node scripts/make-publish-pkgjson.mjs --write; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/chat-ui@"$$version" version >/dev/null 2>&1; then echo "@sentropic/chat-ui@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: typecheck-cowork-bridge
typecheck-cowork-bridge: ## Run @sentropic/cowork-bridge type checks
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/cowork-bridge $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/cowork-bridge $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node svelte@5.55.7 >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/svelte" node_modules/svelte; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" --noEmit -p tsconfig.json'

.PHONY: test-cowork-bridge
test-cowork-bridge: ## Run @sentropic/cowork-bridge tests
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/cowork-bridge $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/cowork-bridge $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node svelte@5.55.7 >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/vitest" node_modules/vitest; ln -sfn "$$tool_dir/node_modules/svelte" node_modules/svelte; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/vitest" run tests --environment node'

.PHONY: build-cowork-bridge
build-cowork-bridge: ## Build @sentropic/cowork-bridge dist package
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/cowork-bridge $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/cowork-bridge $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node svelte@5.55.7 >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/svelte" node_modules/svelte; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" -p tsconfig.json'

.PHONY: pack-cowork-bridge
pack-cowork-bridge: build-cowork-bridge ## Validate @sentropic/cowork-bridge npm package contents without publishing
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/cowork-bridge $(LLM_MESH_NODE_IMAGE) sh -lc 'npm pack --dry-run'

.PHONY: publish-cowork-bridge
publish-cowork-bridge: build-cowork-bridge ## Publish @sentropic/cowork-bridge from CI OIDC trusted publishing
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-e GITHUB_ACTIONS \
		-e GITHUB_REPOSITORY \
		-e GITHUB_REF \
		-e GITHUB_SHA \
		-e GITHUB_EVENT_NAME \
		-e GITHUB_RUN_ID \
		-e GITHUB_RUN_ATTEMPT \
		-e GITHUB_SERVER_URL \
		-e GITHUB_REPOSITORY_ID \
		-e GITHUB_REPOSITORY_OWNER_ID \
		-e GITHUB_WORKFLOW \
		-e GITHUB_WORKFLOW_REF \
		-e GITHUB_WORKFLOW_SHA \
		-e ACTIONS_ID_TOKEN_REQUEST_URL \
		-e ACTIONS_ID_TOKEN_REQUEST_TOKEN \
		-v "$(CURDIR):/workspace" \
		-w /workspace/packages/cowork-bridge \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/cowork-bridge@"$$version" version >/dev/null 2>&1; then echo "@sentropic/cowork-bridge@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-cowork-bridge-token
publish-cowork-bridge-token: build-cowork-bridge ## Publish @sentropic/cowork-bridge using a token read from NPM_TOKEN_FILE (bootstrap only; prefer OIDC publish-cowork-bridge in CI)
	@test -s "$(NPM_TOKEN_FILE)" || { echo "ERROR: $(NPM_TOKEN_FILE) is missing or empty"; exit 1; }
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" \
		-v "$(NPM_TOKEN_FILE):/run/npm-token:ro" \
		-w /workspace/packages/cowork-bridge \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; token="$$(cat /run/npm-token)"; printf "//registry.npmjs.org/:_authToken=%s\n" "$$token" > /tmp/.npmrc; export NPM_CONFIG_USERCONFIG=/tmp/.npmrc; npm whoami --registry=https://registry.npmjs.org; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/cowork-bridge@"$$version" version >/dev/null 2>&1; then echo "@sentropic/cowork-bridge@$$version already exists; skipping publish"; else npm publish --access public; fi'

# --- @sentropic/build-cli (BR42a1-EX1: additive lane; pure-Node, node test env) ---
.PHONY: typecheck-build-cli
typecheck-build-cli: ## Run @sentropic/build-cli type checks
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/build-cli $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/build-cli $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/@types" node_modules/@types; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" --noEmit -p tsconfig.json'

.PHONY: test-build-cli
test-build-cli: ## Run @sentropic/build-cli tests
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/build-cli $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/build-cli $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/vitest" node_modules/vitest; ln -sfn "$$tool_dir/node_modules/@types" node_modules/@types; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/vitest" run tests --environment node'

.PHONY: build-build-cli
build-build-cli: ## Build @sentropic/build-cli dist package
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/build-cli $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/build-cli $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/@types" node_modules/@types; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" -p tsconfig.json'

.PHONY: pack-build-cli
pack-build-cli: build-build-cli ## Validate @sentropic/build-cli npm package contents without publishing
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/build-cli $(LLM_MESH_NODE_IMAGE) sh -lc 'npm pack --dry-run'

# --- @sentropic/harness (BR42h-EX1: additive lane; tooling-only, pure-TS, node test env) ---
.PHONY: typecheck-harness test-harness build-harness pack-harness
typecheck-harness: ## Run @sentropic/harness type checks
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/harness $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/harness $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/@types" node_modules/@types; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" --noEmit -p tsconfig.json'

test-harness: ## Run @sentropic/harness tests
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/harness $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/harness $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/vitest" node_modules/vitest; ln -sfn "$$tool_dir/node_modules/@types" node_modules/@types; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/vitest" run tests --environment node'

build-harness: ## Build @sentropic/harness dist package
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/harness $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/harness $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/@types" node_modules/@types; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" -p tsconfig.json'

pack-harness: build-harness ## Validate @sentropic/harness npm package contents without publishing
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/harness $(LLM_MESH_NODE_IMAGE) sh -lc 'npm pack --dry-run'

# --- @sentropic/focus (BR-FOCUS-EX (Makefile): focus gained its first real runtime dep
#     @sentropic/track, so it builds via the WORKSPACE node_modules — the install-internal-packages
#     + `npx --offline tsc/vitest` pattern used by chat-core/comments — NOT the isolated zero-dep
#     temp-toolset (which cannot resolve @sentropic/track + its transitive deps). Private, pure-TS
#     render-core + the /track read binding; node test env. install-internal-packages installs the
#     packages/focus workspace (incl. @sentropic/track@0.17.0) into node_modules from the lockfile.) ---
.PHONY: typecheck-focus test-focus build-focus pack-focus
typecheck-focus: install-internal-packages ## Run @sentropic/focus type checks (requires @sentropic/track in workspace node_modules)
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/focus $(LLM_MESH_NODE_IMAGE) sh -lc 'npx --offline tsc --noEmit -p tsconfig.json'

test-focus: install-internal-packages ## Run @sentropic/focus tests (requires @sentropic/track in workspace node_modules)
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/focus $(LLM_MESH_NODE_IMAGE) sh -lc 'npx --offline vitest run tests --environment node'

build-focus: install-internal-packages ## Build @sentropic/focus dist package (requires @sentropic/track in workspace node_modules)
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/focus $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist && npx --offline tsc -p tsconfig.json'

pack-focus: build-focus ## Validate @sentropic/focus npm package contents without publishing
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/focus $(LLM_MESH_NODE_IMAGE) sh -lc 'npm pack --dry-run'

.PHONY: publish-harness
publish-harness: build-harness ## Publish @sentropic/harness from CI OIDC trusted publishing
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-e GITHUB_ACTIONS \
		-e GITHUB_REPOSITORY \
		-e GITHUB_REF \
		-e GITHUB_SHA \
		-e GITHUB_EVENT_NAME \
		-e GITHUB_RUN_ID \
		-e GITHUB_RUN_ATTEMPT \
		-e GITHUB_SERVER_URL \
		-e GITHUB_REPOSITORY_ID \
		-e GITHUB_REPOSITORY_OWNER_ID \
		-e GITHUB_WORKFLOW \
		-e GITHUB_WORKFLOW_REF \
		-e GITHUB_WORKFLOW_SHA \
		-e ACTIONS_ID_TOKEN_REQUEST_URL \
		-e ACTIONS_ID_TOKEN_REQUEST_TOKEN \
		-v "$(CURDIR):/workspace" \
		-w /workspace/packages/harness \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/harness@"$$version" version >/dev/null 2>&1; then echo "@sentropic/harness@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-harness-token
publish-harness-token: build-harness ## Publish @sentropic/harness using NPM_TOKEN_FILE (bootstrap only; prefer OIDC publish-harness in CI)
	@test -s "$(NPM_TOKEN_FILE)" || { echo "ERROR: $(NPM_TOKEN_FILE) is missing or empty"; exit 1; }
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" \
		-v "$(NPM_TOKEN_FILE):/run/npm-token:ro" \
		-w /workspace/packages/harness \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; token="$$(cat /run/npm-token)"; printf "//registry.npmjs.org/:_authToken=%s\n" "$$token" > /tmp/.npmrc; export NPM_CONFIG_USERCONFIG=/tmp/.npmrc; npm whoami --registry=https://registry.npmjs.org; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/harness@"$$version" version >/dev/null 2>&1; then echo "@sentropic/harness@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: scope-check
scope-check: build-harness ## Advisory C2 scope-check of local changes (staged+unstaged) vs BRANCH.md (BR42h-EX1)
	@files="$$( { git diff --cached --name-only; git diff --name-only; } | sort -u | paste -sd, - )"; \
	docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/harness $(LLM_MESH_NODE_IMAGE) node dist/bin/harness.js check scope --branch-md /workspace/BRANCH.md --staged-files "$$files"

# --- @sentropic/cli (BR42a1-EX1: additive lane; pure-Node, node test env) ---
.PHONY: typecheck-cli
typecheck-cli: ## Run @sentropic/cli type checks
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/cli $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/cli $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/@types" node_modules/@types; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" --noEmit -p tsconfig.json'

.PHONY: test-cli
test-cli: ## Run @sentropic/cli tests
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/cli $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/cli $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/vitest" node_modules/vitest; ln -sfn "$$tool_dir/node_modules/@types" node_modules/@types; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/vitest" run tests --environment node'

.PHONY: build-cli
build-cli: ## Build @sentropic/cli dist package
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/cli $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/cli $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/@types" node_modules/@types; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" -p tsconfig.json'

.PHONY: pack-cli
pack-cli: build-cli ## Validate @sentropic/cli npm package contents without publishing
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/cli $(LLM_MESH_NODE_IMAGE) sh -lc 'npm pack --dry-run'

.PHONY: publish-build-cli
publish-build-cli: build-build-cli ## Publish @sentropic/build-cli from CI OIDC trusted publishing
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-e GITHUB_ACTIONS \
		-e GITHUB_REPOSITORY \
		-e GITHUB_REF \
		-e GITHUB_SHA \
		-e GITHUB_EVENT_NAME \
		-e GITHUB_RUN_ID \
		-e GITHUB_RUN_ATTEMPT \
		-e GITHUB_SERVER_URL \
		-e GITHUB_REPOSITORY_ID \
		-e GITHUB_REPOSITORY_OWNER_ID \
		-e GITHUB_WORKFLOW \
		-e GITHUB_WORKFLOW_REF \
		-e GITHUB_WORKFLOW_SHA \
		-e ACTIONS_ID_TOKEN_REQUEST_URL \
		-e ACTIONS_ID_TOKEN_REQUEST_TOKEN \
		-v "$(CURDIR):/workspace" \
		-w /workspace/packages/build-cli \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/build-cli@"$$version" version >/dev/null 2>&1; then echo "@sentropic/build-cli@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-build-cli-token
publish-build-cli-token: build-build-cli ## Publish @sentropic/build-cli using NPM_TOKEN_FILE (bootstrap only; prefer OIDC publish-build-cli in CI)
	@test -s "$(NPM_TOKEN_FILE)" || { echo "ERROR: $(NPM_TOKEN_FILE) is missing or empty"; exit 1; }
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" \
		-v "$(NPM_TOKEN_FILE):/run/npm-token:ro" \
		-w /workspace/packages/build-cli \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; token="$$(cat /run/npm-token)"; printf "//registry.npmjs.org/:_authToken=%s\n" "$$token" > /tmp/.npmrc; export NPM_CONFIG_USERCONFIG=/tmp/.npmrc; npm whoami --registry=https://registry.npmjs.org; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/build-cli@"$$version" version >/dev/null 2>&1; then echo "@sentropic/build-cli@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-cli
publish-cli: build-cli ## Publish @sentropic/cli from CI OIDC trusted publishing
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-e GITHUB_ACTIONS \
		-e GITHUB_REPOSITORY \
		-e GITHUB_REF \
		-e GITHUB_SHA \
		-e GITHUB_EVENT_NAME \
		-e GITHUB_RUN_ID \
		-e GITHUB_RUN_ATTEMPT \
		-e GITHUB_SERVER_URL \
		-e GITHUB_REPOSITORY_ID \
		-e GITHUB_REPOSITORY_OWNER_ID \
		-e GITHUB_WORKFLOW \
		-e GITHUB_WORKFLOW_REF \
		-e GITHUB_WORKFLOW_SHA \
		-e ACTIONS_ID_TOKEN_REQUEST_URL \
		-e ACTIONS_ID_TOKEN_REQUEST_TOKEN \
		-v "$(CURDIR):/workspace" \
		-w /workspace/packages/cli \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/cli@"$$version" version >/dev/null 2>&1; then echo "@sentropic/cli@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-cli-token
publish-cli-token: build-cli ## Publish @sentropic/cli using NPM_TOKEN_FILE (bootstrap only; prefer OIDC publish-cli in CI)
	@test -s "$(NPM_TOKEN_FILE)" || { echo "ERROR: $(NPM_TOKEN_FILE) is missing or empty"; exit 1; }
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" \
		-v "$(NPM_TOKEN_FILE):/run/npm-token:ro" \
		-w /workspace/packages/cli \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; token="$$(cat /run/npm-token)"; printf "//registry.npmjs.org/:_authToken=%s\n" "$$token" > /tmp/.npmrc; export NPM_CONFIG_USERCONFIG=/tmp/.npmrc; npm whoami --registry=https://registry.npmjs.org; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/cli@"$$version" version >/dev/null 2>&1; then echo "@sentropic/cli@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: typecheck-cowork-desktop
typecheck-cowork-desktop: ## Run @sentropic/cowork-desktop type checks
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/cowork-desktop $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/cowork-desktop $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node svelte@5.55.7 >/dev/null; mkdir -p node_modules/@sentropic; ln -sfn ../../../cowork-bridge node_modules/@sentropic/cowork-bridge; ln -sfn ../../../chat-ui node_modules/@sentropic/chat-ui; ln -sfn "$$tool_dir/node_modules/@types" node_modules/@types;ln -sfn "$$tool_dir/node_modules/svelte" node_modules/svelte; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" --noEmit -p tsconfig.json'

.PHONY: test-cowork-desktop
test-cowork-desktop: ## Run @sentropic/cowork-desktop tests
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/cowork-desktop $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/cowork-desktop $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node svelte@5.55.7 >/dev/null; mkdir -p node_modules/@sentropic; ln -sfn ../../../cowork-bridge node_modules/@sentropic/cowork-bridge; ln -sfn ../../../chat-ui node_modules/@sentropic/chat-ui; ln -sfn "$$tool_dir/node_modules/@types" node_modules/@types;ln -sfn "$$tool_dir/node_modules/vitest" node_modules/vitest; ln -sfn "$$tool_dir/node_modules/svelte" node_modules/svelte; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/vitest" run tests --environment node'

.PHONY: build-cowork-desktop
build-cowork-desktop: ## Build @sentropic/cowork-desktop dist package
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/cowork-desktop $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/cowork-desktop $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node svelte@5.55.7 >/dev/null; mkdir -p node_modules/@sentropic; ln -sfn ../../../cowork-bridge node_modules/@sentropic/cowork-bridge; ln -sfn ../../../chat-ui node_modules/@sentropic/chat-ui; ln -sfn "$$tool_dir/node_modules/@types" node_modules/@types;ln -sfn "$$tool_dir/node_modules/svelte" node_modules/svelte; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" -p tsconfig.json'

.PHONY: pack-cowork-desktop
pack-cowork-desktop: build-cowork-desktop ## Validate @sentropic/cowork-desktop npm package contents without publishing
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/cowork-desktop $(LLM_MESH_NODE_IMAGE) sh -lc 'npm pack --dry-run'

.PHONY: publish-cowork-desktop
publish-cowork-desktop: build-cowork-desktop ## Publish @sentropic/cowork-desktop from CI OIDC trusted publishing
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-e GITHUB_ACTIONS \
		-e GITHUB_REPOSITORY \
		-e GITHUB_REF \
		-e GITHUB_SHA \
		-e GITHUB_EVENT_NAME \
		-e GITHUB_RUN_ID \
		-e GITHUB_RUN_ATTEMPT \
		-e GITHUB_SERVER_URL \
		-e GITHUB_REPOSITORY_ID \
		-e GITHUB_REPOSITORY_OWNER_ID \
		-e GITHUB_WORKFLOW \
		-e GITHUB_WORKFLOW_REF \
		-e GITHUB_WORKFLOW_SHA \
		-e ACTIONS_ID_TOKEN_REQUEST_URL \
		-e ACTIONS_ID_TOKEN_REQUEST_TOKEN \
		-v "$(CURDIR):/workspace" \
		-w /workspace/packages/cowork-desktop \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/cowork-desktop@"$$version" version >/dev/null 2>&1; then echo "@sentropic/cowork-desktop@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-cowork-desktop-token
publish-cowork-desktop-token: build-cowork-desktop ## Publish @sentropic/cowork-desktop using a token read from NPM_TOKEN_FILE (bootstrap only; prefer OIDC publish-cowork-desktop in CI)
	@test -s "$(NPM_TOKEN_FILE)" || { echo "ERROR: $(NPM_TOKEN_FILE) is missing or empty"; exit 1; }
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" \
		-v "$(NPM_TOKEN_FILE):/run/npm-token:ro" \
		-w /workspace/packages/cowork-desktop \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; token="$$(cat /run/npm-token)"; printf "//registry.npmjs.org/:_authToken=%s\n" "$$token" > /tmp/.npmrc; export NPM_CONFIG_USERCONFIG=/tmp/.npmrc; npm whoami --registry=https://registry.npmjs.org; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/cowork-desktop@"$$version" version >/dev/null 2>&1; then echo "@sentropic/cowork-desktop@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: package-desktop-windows
package-desktop-windows: ## Build the signable single Windows .exe for @sentropic/cowork-desktop (BR41a Lot 5). Signing is gated on COWORK_SIGN_PFX (+ COWORK_SIGN_PASS); skipped with a warning if absent.
	@echo "📦 Packaging @sentropic/cowork-desktop -> single Windows .exe (esbuild + @yao-pkg/pkg + osslsigncode)…"
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/cowork-desktop $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules build'
	@docker run --rm \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-e COWORK_SIGN_PFX="$${COWORK_SIGN_PFX:-}" \
		-e COWORK_SIGN_PASS="$${COWORK_SIGN_PASS:-}" \
		-e COWORK_SIGN_TS_URL="$${COWORK_SIGN_TS_URL:-}" \
		$(if $(COWORK_SIGN_PFX),-v "$(COWORK_SIGN_PFX):$(COWORK_SIGN_PFX):ro",) \
		-v "$(CURDIR):/workspace" \
		-w /workspace/packages/cowork-desktop \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; \
			export DEBIAN_FRONTEND=noninteractive; \
			apt-get update -qq >/dev/null && apt-get install -y -qq --no-install-recommends osslsigncode zip ca-certificates >/dev/null; \
			tool_dir="$$(mktemp -d)"; \
			npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund esbuild@0.25.10 @yao-pkg/pkg@6.9.0 typescript@5.4.5 @types/node svelte@5.55.7 >/dev/null; \
			mkdir -p node_modules/@sentropic node_modules/.bin; \
			ln -sfn ../../../cowork-bridge node_modules/@sentropic/cowork-bridge; \
			ln -sfn ../../../chat-ui node_modules/@sentropic/chat-ui; \
			ln -sfn "$$tool_dir/node_modules/@types" node_modules/@types; \
			ln -sfn "$$tool_dir/node_modules/svelte" node_modules/svelte; \
			ln -sfn "$$tool_dir/node_modules/esbuild" node_modules/esbuild; \
			ln -sfn "$$tool_dir/node_modules/.bin/pkg" node_modules/.bin/pkg; \
			export PATH="$$PWD/node_modules/.bin:$$tool_dir/node_modules/.bin:$$PATH"; \
			export NODE_PATH="$$tool_dir/node_modules"; \
			node packaging/package-windows.mjs; \
			rm -rf node_modules'
	@docker run --rm -e HOST_UID=$$(id -u) -e HOST_GID=$$(id -g) -v "$(CURDIR):/workspace" -w /workspace $(LLM_MESH_NODE_IMAGE) sh -lc 'chown -R "$$HOST_UID:$$HOST_GID" /workspace/packages/cowork-desktop/build /workspace/ui/static/cowork-desktop 2>/dev/null || true'
	@echo "✅ Windows .exe packaged in ui/static/cowork-desktop/"

.PHONY: install-internal-packages
install-internal-packages: ## Install workspace deps and link @sentropic/{contracts,events,chat-core,flow,focus} into node_modules (no api/ui)
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace $(LLM_MESH_NODE_IMAGE) sh -lc 'npm ci --workspace=packages/contracts --workspace=packages/events --workspace=packages/chat-core --workspace=packages/flow --workspace=packages/focus --include-workspace-root --ignore-scripts --no-audit --no-fund'

.PHONY: build-contracts
build-contracts: install-internal-packages ## Build @sentropic/contracts dist package (standalone, no @sentropic deps)
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/contracts $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist && npx --offline tsc -p tsconfig.json'

.PHONY: build-events
build-events: build-contracts ## Build @sentropic/events dist package (depends on contracts dist)
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/events $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist && npx --offline tsc -p tsconfig.json'

.PHONY: build-chat-core
build-chat-core: build-events ## Build @sentropic/chat-core dist package (depends on contracts + events dist)
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/chat-core $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist && npx --offline tsc -p tsconfig.json'

.PHONY: build-chat-server
build-chat-server: ## Build @sentropic/chat-server dist package
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/chat-server $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/chat-server $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node hono@4.10.7 >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/hono" node_modules/hono; ln -sfn "$$tool_dir/node_modules/@types" node_modules/@types; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" -p tsconfig.json'

.PHONY: build-comments
build-comments: build-contracts ## Build @sentropic/comments dist package (depends on contracts dist)
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/comments $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist && npx --offline tsc -p tsconfig.json'

.PHONY: build-ubo-contracts
build-ubo-contracts: ## Build @sentropic/ubo-contracts (private, BR-59) dist package — no @sentropic deps
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/ubo-contracts $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf dist && npx --offline tsc -p tsconfig.json'

.PHONY: typecheck-contracts
typecheck-contracts: install-internal-packages ## Run @sentropic/contracts type checks
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/contracts $(LLM_MESH_NODE_IMAGE) sh -lc 'npx --offline tsc --noEmit -p tsconfig.json'

.PHONY: typecheck-events
typecheck-events: build-contracts ## Run @sentropic/events type checks (requires contracts dist)
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/events $(LLM_MESH_NODE_IMAGE) sh -lc 'npx --offline tsc --noEmit -p tsconfig.json'

.PHONY: typecheck-chat-core
typecheck-chat-core: build-events ## Run @sentropic/chat-core type checks (requires contracts+events dist)
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/chat-core $(LLM_MESH_NODE_IMAGE) sh -lc 'npx --offline tsc --noEmit -p tsconfig.json'

.PHONY: typecheck-chat-server
typecheck-chat-server: ## Run @sentropic/chat-server type checks
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/chat-server $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/chat-server $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node hono@4.10.7 >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/hono" node_modules/hono; ln -sfn "$$tool_dir/node_modules/@types" node_modules/@types; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/tsc" --noEmit -p tsconfig.json'

.PHONY: typecheck-comments
typecheck-comments: build-contracts ## Run @sentropic/comments type checks (requires contracts dist)
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/comments $(LLM_MESH_NODE_IMAGE) sh -lc 'npx --offline tsc --noEmit -p tsconfig.json'

.PHONY: pack-contracts
pack-contracts: build-contracts ## Validate @sentropic/contracts npm package contents without publishing
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/contracts $(LLM_MESH_NODE_IMAGE) sh -lc 'npm pack --dry-run'

.PHONY: pack-events
pack-events: build-events ## Validate @sentropic/events npm package contents without publishing
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/events $(LLM_MESH_NODE_IMAGE) sh -lc 'npm pack --dry-run'

.PHONY: pack-chat-core
pack-chat-core: build-chat-core ## Validate @sentropic/chat-core npm package contents without publishing
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/chat-core $(LLM_MESH_NODE_IMAGE) sh -lc 'npm pack --dry-run'

.PHONY: pack-chat-server
pack-chat-server: build-chat-server ## Validate @sentropic/chat-server npm package contents without publishing
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/chat-server $(LLM_MESH_NODE_IMAGE) sh -lc 'npm pack --dry-run'

.PHONY: pack-comments
pack-comments: build-comments ## Validate @sentropic/comments npm package contents without publishing
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/comments $(LLM_MESH_NODE_IMAGE) sh -lc 'npm pack --dry-run'

.PHONY: pack-flow
pack-flow: build-flow ## Validate @sentropic/flow npm package contents without publishing
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/packages/flow $(FLOW_NODE_IMAGE) sh -lc 'npm pack --dry-run'

.PHONY: publish-contracts
publish-contracts: build-contracts ## Publish @sentropic/contracts from CI OIDC trusted publishing
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-e GITHUB_ACTIONS \
		-e GITHUB_REPOSITORY \
		-e GITHUB_REF \
		-e GITHUB_SHA \
		-e GITHUB_EVENT_NAME \
		-e GITHUB_RUN_ID \
		-e GITHUB_RUN_ATTEMPT \
		-e GITHUB_SERVER_URL \
		-e GITHUB_REPOSITORY_ID \
		-e GITHUB_REPOSITORY_OWNER_ID \
		-e GITHUB_WORKFLOW \
		-e GITHUB_WORKFLOW_REF \
		-e GITHUB_WORKFLOW_SHA \
		-e ACTIONS_ID_TOKEN_REQUEST_URL \
		-e ACTIONS_ID_TOKEN_REQUEST_TOKEN \
		-v "$(CURDIR):/workspace" \
		-w /workspace/packages/contracts \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/contracts@"$$version" version >/dev/null 2>&1; then echo "@sentropic/contracts@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-contracts-token
publish-contracts-token: build-contracts ## Publish @sentropic/contracts using NPM_TOKEN_FILE (bootstrap only; prefer OIDC publish-contracts in CI)
	@test -s "$(NPM_TOKEN_FILE)" || { echo "ERROR: $(NPM_TOKEN_FILE) is missing or empty"; exit 1; }
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" \
		-v "$(NPM_TOKEN_FILE):/run/npm-token:ro" \
		-w /workspace/packages/contracts \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; token="$$(cat /run/npm-token)"; printf "//registry.npmjs.org/:_authToken=%s\n" "$$token" > /tmp/.npmrc; export NPM_CONFIG_USERCONFIG=/tmp/.npmrc; npm whoami --registry=https://registry.npmjs.org; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/contracts@"$$version" version >/dev/null 2>&1; then echo "@sentropic/contracts@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-events
publish-events: build-events ## Publish @sentropic/events from CI OIDC trusted publishing
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-e GITHUB_ACTIONS \
		-e GITHUB_REPOSITORY \
		-e GITHUB_REF \
		-e GITHUB_SHA \
		-e GITHUB_EVENT_NAME \
		-e GITHUB_RUN_ID \
		-e GITHUB_RUN_ATTEMPT \
		-e GITHUB_SERVER_URL \
		-e GITHUB_REPOSITORY_ID \
		-e GITHUB_REPOSITORY_OWNER_ID \
		-e GITHUB_WORKFLOW \
		-e GITHUB_WORKFLOW_REF \
		-e GITHUB_WORKFLOW_SHA \
		-e ACTIONS_ID_TOKEN_REQUEST_URL \
		-e ACTIONS_ID_TOKEN_REQUEST_TOKEN \
		-v "$(CURDIR):/workspace" \
		-w /workspace/packages/events \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/events@"$$version" version >/dev/null 2>&1; then echo "@sentropic/events@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-events-token
publish-events-token: build-events ## Publish @sentropic/events using NPM_TOKEN_FILE (bootstrap only; prefer OIDC publish-events in CI)
	@test -s "$(NPM_TOKEN_FILE)" || { echo "ERROR: $(NPM_TOKEN_FILE) is missing or empty"; exit 1; }
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" \
		-v "$(NPM_TOKEN_FILE):/run/npm-token:ro" \
		-w /workspace/packages/events \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; token="$$(cat /run/npm-token)"; printf "//registry.npmjs.org/:_authToken=%s\n" "$$token" > /tmp/.npmrc; export NPM_CONFIG_USERCONFIG=/tmp/.npmrc; npm whoami --registry=https://registry.npmjs.org; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/events@"$$version" version >/dev/null 2>&1; then echo "@sentropic/events@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-chat-core
publish-chat-core: build-chat-core ## Publish @sentropic/chat-core from CI OIDC trusted publishing
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-e GITHUB_ACTIONS \
		-e GITHUB_REPOSITORY \
		-e GITHUB_REF \
		-e GITHUB_SHA \
		-e GITHUB_EVENT_NAME \
		-e GITHUB_RUN_ID \
		-e GITHUB_RUN_ATTEMPT \
		-e GITHUB_SERVER_URL \
		-e GITHUB_REPOSITORY_ID \
		-e GITHUB_REPOSITORY_OWNER_ID \
		-e GITHUB_WORKFLOW \
		-e GITHUB_WORKFLOW_REF \
		-e GITHUB_WORKFLOW_SHA \
		-e ACTIONS_ID_TOKEN_REQUEST_URL \
		-e ACTIONS_ID_TOKEN_REQUEST_TOKEN \
		-v "$(CURDIR):/workspace" \
		-w /workspace/packages/chat-core \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/chat-core@"$$version" version >/dev/null 2>&1; then echo "@sentropic/chat-core@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-chat-core-token
publish-chat-core-token: build-chat-core ## Publish @sentropic/chat-core using NPM_TOKEN_FILE (bootstrap only; prefer OIDC publish-chat-core in CI)
	@test -s "$(NPM_TOKEN_FILE)" || { echo "ERROR: $(NPM_TOKEN_FILE) is missing or empty"; exit 1; }
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" \
		-v "$(NPM_TOKEN_FILE):/run/npm-token:ro" \
		-w /workspace/packages/chat-core \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; token="$$(cat /run/npm-token)"; printf "//registry.npmjs.org/:_authToken=%s\n" "$$token" > /tmp/.npmrc; export NPM_CONFIG_USERCONFIG=/tmp/.npmrc; npm whoami --registry=https://registry.npmjs.org; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/chat-core@"$$version" version >/dev/null 2>&1; then echo "@sentropic/chat-core@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-chat-server
publish-chat-server: build-chat-server ## Publish @sentropic/chat-server from CI OIDC trusted publishing
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-e GITHUB_ACTIONS \
		-e GITHUB_REPOSITORY \
		-e GITHUB_REF \
		-e GITHUB_SHA \
		-e GITHUB_EVENT_NAME \
		-e GITHUB_RUN_ID \
		-e GITHUB_RUN_ATTEMPT \
		-e GITHUB_SERVER_URL \
		-e GITHUB_REPOSITORY_ID \
		-e GITHUB_REPOSITORY_OWNER_ID \
		-e GITHUB_WORKFLOW \
		-e GITHUB_WORKFLOW_REF \
		-e GITHUB_WORKFLOW_SHA \
		-e ACTIONS_ID_TOKEN_REQUEST_URL \
		-e ACTIONS_ID_TOKEN_REQUEST_TOKEN \
		-v "$(CURDIR):/workspace" \
		-w /workspace/packages/chat-server \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/chat-server@"$$version" version >/dev/null 2>&1; then echo "@sentropic/chat-server@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-chat-server-token
publish-chat-server-token: build-chat-server ## Publish @sentropic/chat-server using NPM_TOKEN_FILE (bootstrap only; prefer OIDC publish-chat-server in CI)
	@test -s "$(NPM_TOKEN_FILE)" || { echo "ERROR: $(NPM_TOKEN_FILE) is missing or empty"; exit 1; }
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" \
		-v "$(NPM_TOKEN_FILE):/run/npm-token:ro" \
		-w /workspace/packages/chat-server \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; token="$$(cat /run/npm-token)"; printf "//registry.npmjs.org/:_authToken=%s\n" "$$token" > /tmp/.npmrc; export NPM_CONFIG_USERCONFIG=/tmp/.npmrc; npm whoami --registry=https://registry.npmjs.org; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/chat-server@"$$version" version >/dev/null 2>&1; then echo "@sentropic/chat-server@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-comments
publish-comments: build-comments ## Publish @sentropic/comments from CI OIDC trusted publishing
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-e GITHUB_ACTIONS \
		-e GITHUB_REPOSITORY \
		-e GITHUB_REF \
		-e GITHUB_SHA \
		-e GITHUB_EVENT_NAME \
		-e GITHUB_RUN_ID \
		-e GITHUB_RUN_ATTEMPT \
		-e GITHUB_SERVER_URL \
		-e GITHUB_REPOSITORY_ID \
		-e GITHUB_REPOSITORY_OWNER_ID \
		-e GITHUB_WORKFLOW \
		-e GITHUB_WORKFLOW_REF \
		-e GITHUB_WORKFLOW_SHA \
		-e ACTIONS_ID_TOKEN_REQUEST_URL \
		-e ACTIONS_ID_TOKEN_REQUEST_TOKEN \
		-v "$(CURDIR):/workspace" \
		-w /workspace/packages/comments \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/comments@"$$version" version >/dev/null 2>&1; then echo "@sentropic/comments@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-comments-token
publish-comments-token: build-comments ## Publish @sentropic/comments using NPM_TOKEN_FILE (bootstrap only; prefer OIDC publish-comments in CI)
	@test -s "$(NPM_TOKEN_FILE)" || { echo "ERROR: $(NPM_TOKEN_FILE) is missing or empty"; exit 1; }
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" \
		-v "$(NPM_TOKEN_FILE):/run/npm-token:ro" \
		-w /workspace/packages/comments \
		$(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; token="$$(cat /run/npm-token)"; printf "//registry.npmjs.org/:_authToken=%s\n" "$$token" > /tmp/.npmrc; export NPM_CONFIG_USERCONFIG=/tmp/.npmrc; npm whoami --registry=https://registry.npmjs.org; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/comments@"$$version" version >/dev/null 2>&1; then echo "@sentropic/comments@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-flow
publish-flow: build-flow ## Publish @sentropic/flow from CI OIDC trusted publishing
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-e GITHUB_ACTIONS \
		-e GITHUB_REPOSITORY \
		-e GITHUB_REF \
		-e GITHUB_SHA \
		-e GITHUB_EVENT_NAME \
		-e GITHUB_RUN_ID \
		-e GITHUB_RUN_ATTEMPT \
		-e GITHUB_SERVER_URL \
		-e GITHUB_REPOSITORY_ID \
		-e GITHUB_REPOSITORY_OWNER_ID \
		-e GITHUB_WORKFLOW \
		-e GITHUB_WORKFLOW_REF \
		-e GITHUB_WORKFLOW_SHA \
		-e ACTIONS_ID_TOKEN_REQUEST_URL \
		-e ACTIONS_ID_TOKEN_REQUEST_TOKEN \
		-v "$(CURDIR):/workspace" \
		-w /workspace/packages/flow \
		$(FLOW_NODE_IMAGE) sh -lc 'set -eu; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/flow@"$$version" version >/dev/null 2>&1; then echo "@sentropic/flow@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: publish-flow-token
publish-flow-token: build-flow ## Publish @sentropic/flow using NPM_TOKEN_FILE (bootstrap only; prefer OIDC publish-flow in CI)
	@test -s "$(NPM_TOKEN_FILE)" || { echo "ERROR: $(NPM_TOKEN_FILE) is missing or empty"; exit 1; }
	@docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" \
		-v "$(NPM_TOKEN_FILE):/run/npm-token:ro" \
		-w /workspace/packages/flow \
		$(FLOW_NODE_IMAGE) sh -lc 'set -eu; token="$$(cat /run/npm-token)"; printf "//registry.npmjs.org/:_authToken=%s\n" "$$token" > /tmp/.npmrc; export NPM_CONFIG_USERCONFIG=/tmp/.npmrc; npm whoami --registry=https://registry.npmjs.org; version="$$(node -p "require(\"./package.json\").version")"; if npm view @sentropic/flow@"$$version" version >/dev/null 2>&1; then echo "@sentropic/flow@$$version already exists; skipping publish"; else npm publish --access public; fi'

.PHONY: lint
lint: lint-ui lint-api ## Run all linters

.PHONY: lint-ui
lint-ui: up-ui ## Run UI linter
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T ui npm run lint

.PHONY: lint-api
lint-api: prepare-node-workspace ## Run API linter
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps api npm run lint

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

.PHONY: test-llm-mesh
test-llm-mesh: ## Run @sentropic/llm-mesh tests
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/llm-mesh $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node >/dev/null; NODE_PATH="$$tool_dir/node_modules" "$$tool_dir/node_modules/.bin/vitest" run tests --environment node'

# BR-LB-EX1 — @sentropic/llm-gateway tests (WP16 Layer-B; owner-approved 2026-06-22).
# Mirrors test-auth-hono: build the sibling @sentropic/llm-mesh dist, symlink it + hono +
# vitest into the gateway's node_modules, then run vitest over tests (node env).
.PHONY: test-llm-gateway
test-llm-gateway: build-llm-mesh ## Run @sentropic/llm-gateway tests
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/llm-gateway $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/llm-gateway $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; scope="$(SCOPE)"; scope="$${scope#packages/llm-gateway/}"; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node hono@4.10.7 >/dev/null; mkdir -p node_modules/@sentropic node_modules/@types; ln -sfn "$$tool_dir/node_modules/hono" node_modules/hono; ln -sfn "$$tool_dir/node_modules/vitest" node_modules/vitest; ln -sfn "$$tool_dir/node_modules/@types/node" node_modules/@types/node; ln -sfn /workspace/packages/llm-mesh node_modules/@sentropic/llm-mesh; trap "rm -rf node_modules" EXIT; if [ -n "$$scope" ]; then "$$tool_dir/node_modules/.bin/vitest" run "$$scope" --environment node; else "$$tool_dir/node_modules/.bin/vitest" run tests --environment node; fi'
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/llm-gateway $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'

.PHONY: test-chat-ui
test-chat-ui: ## Run @sentropic/chat-ui tests
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/chat-ui $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/chat-ui $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node svelte@5.55.7 >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/vitest" node_modules/vitest; ln -sfn "$$tool_dir/node_modules/svelte" node_modules/svelte; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/vitest" run tests --environment node --exclude "tests/**/*.dom.spec.ts"'

# BR-A0b-EX1 — additive jsdom DOM/ARIA test target for @sentropic/chat-ui Svelte 5 components.
# Rationale: DOM/ARIA harness requires @sveltejs/vite-plugin-svelte + vite + jsdom +
#   @testing-library/svelte@5 (Svelte-5-era), none of which are in the existing node-env target.
#   Scope: additive only — does NOT modify the existing test-chat-ui target.
# Impact: adds ~8 new npm packages installed at test time in an ephemeral docker container;
#   no package.json devDependency changes; no version bump required (test-only infra).
# Rollback: delete this target + tests/spike.dom.spec.ts + tests/model-selector.dom.spec.ts
#   + tests/message-actions.dom.spec.ts + packages/chat-ui/vitest.config.ts.
# BR-CONV-EX1 — add svelte-streamdown@3.0.1 to ephemeral npm install.
# Rationale: StreamMessage.svelte (now statically imported by ChatConversation.svelte) imports
#   Streamdown from svelte-streamdown at the top level. Without svelte-streamdown in the jsdom
#   test environment, any test that mounts ChatConversation (which now statically imports
#   StreamMessage) would fail with a module-not-found error. This mirrors the existing pattern
#   used for @lucide/svelte (same category: Svelte component peer dep).
# Impact: adds svelte-streamdown to the ephemeral Docker npm install; no other target affected;
#   no package.json devDependency or peerDependency change.
# Rollback: remove "svelte-streamdown@3.0.1" from the npm install line and the ln -sfn line
#   below, and remove the chat-conversation.dom.spec.ts StreamMessage wiring test block.
.PHONY: test-chat-ui-dom
test-chat-ui-dom: ## Run @sentropic/chat-ui DOM/ARIA tests (jsdom, Svelte 5, BR-A0b-EX1 + BR-CONV-EX1)
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/chat-ui $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/chat-ui $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node svelte@5.55.7 vite@8.0.16 @sveltejs/vite-plugin-svelte@7.1.2 @testing-library/svelte@5.3.1 jsdom@29.1.1 "@lucide/svelte@0.562.0" "svelte-streamdown@3.0.1" "svelte-preprocess@6.0.3" >/dev/null; mkdir -p node_modules/@sveltejs node_modules/@testing-library node_modules/@lucide; ln -sfn "$$tool_dir/node_modules/vitest" node_modules/vitest; ln -sfn "$$tool_dir/node_modules/svelte" node_modules/svelte; ln -sfn "$$tool_dir/node_modules/vite" node_modules/vite; ln -sfn "$$tool_dir/node_modules/jsdom" node_modules/jsdom; ln -sfn "$$tool_dir/node_modules/@sveltejs/vite-plugin-svelte" node_modules/@sveltejs/vite-plugin-svelte; ln -sfn "$$tool_dir/node_modules/@sveltejs/acorn-typescript" node_modules/@sveltejs/acorn-typescript; ln -sfn "$$tool_dir/node_modules/@testing-library/svelte" node_modules/@testing-library/svelte; ln -sfn "$$tool_dir/node_modules/@testing-library/dom" node_modules/@testing-library/dom; ln -sfn "$$tool_dir/node_modules/@testing-library/svelte-core" node_modules/@testing-library/svelte-core; ln -sfn "$$tool_dir/node_modules/@lucide/svelte" node_modules/@lucide/svelte; ln -sfn "$$tool_dir/node_modules/svelte-streamdown" node_modules/svelte-streamdown; ln -sfn "$$tool_dir/node_modules/svelte-preprocess" node_modules/svelte-preprocess; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/vitest" run --config vitest.dom.config.ts'

.PHONY: test-chat-server
test-chat-server: ## Run @sentropic/chat-server tests
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/chat-server $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/chat-server $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node hono@4.10.7 >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/vitest" node_modules/vitest; ln -sfn "$$tool_dir/node_modules/hono" node_modules/hono; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/vitest" run tests --environment node'

.PHONY: test-comments
test-comments: ## Run @sentropic/comments tests
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/comments $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/comments $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/vitest" node_modules/vitest; ln -sfn "$$tool_dir/node_modules/@types" node_modules/@types; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/vitest" run tests --environment node'

.PHONY: test-auth-hono
test-auth-hono: build-oauth-verify ## Run @sentropic/auth-hono tests
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/auth-hono $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/auth-hono $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; scope="$(SCOPE)"; scope="$${scope#packages/auth-hono/}"; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node hono@4.10.7 @hono/zod-validator@0.7.5 zod@3.25.76 jose@5.10.0 @simplewebauthn/server@13.2.2 >/dev/null; mkdir -p node_modules/@hono node_modules/@simplewebauthn node_modules/@sentropic; ln -sfn "$$tool_dir/node_modules/hono" node_modules/hono; ln -sfn "$$tool_dir/node_modules/@hono/zod-validator" node_modules/@hono/zod-validator; ln -sfn "$$tool_dir/node_modules/zod" node_modules/zod; ln -sfn "$$tool_dir/node_modules/jose" node_modules/jose; ln -sfn "$$tool_dir/node_modules/@simplewebauthn/server" node_modules/@simplewebauthn/server; ln -sfn "$$tool_dir/node_modules/vitest" node_modules/vitest; ln -sfn /workspace/packages/oauth-verify node_modules/@sentropic/oauth-verify; trap "rm -rf node_modules" EXIT; if [ -n "$$scope" ]; then "$$tool_dir/node_modules/.bin/vitest" run "$$scope" --environment node; else "$$tool_dir/node_modules/.bin/vitest" run tests --environment node; fi'
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/auth-hono $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'

.PHONY: test-auth-client
test-auth-client: build-auth-hono ## Run @sentropic/auth-client tests (needs auth-hono dist for the in-process IdP round-trip)
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/auth-client $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules ../auth-hono/node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/auth-client $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; scope="$(SCOPE)"; scope="$${scope#packages/auth-client/}"; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node jose@5.10.0 hono@4.10.7 zod@3.25.76 @hono/zod-validator@0.7.5 @simplewebauthn/server@13.2.2 >/dev/null; mkdir -p node_modules/@sentropic ../auth-hono/node_modules/@hono ../auth-hono/node_modules/@simplewebauthn ../auth-hono/node_modules/@sentropic; ln -sfn "$$tool_dir/node_modules/jose" node_modules/jose; ln -sfn "$$tool_dir/node_modules/hono" node_modules/hono; ln -sfn "$$tool_dir/node_modules/zod" node_modules/zod; ln -sfn "$$tool_dir/node_modules/vitest" node_modules/vitest; ln -sfn /workspace/packages/auth-hono node_modules/@sentropic/auth-hono; ln -sfn /workspace/packages/oauth-verify ../auth-hono/node_modules/@sentropic/oauth-verify; ln -sfn "$$tool_dir/node_modules/hono" ../auth-hono/node_modules/hono; ln -sfn "$$tool_dir/node_modules/jose" ../auth-hono/node_modules/jose; ln -sfn "$$tool_dir/node_modules/zod" ../auth-hono/node_modules/zod; ln -sfn "$$tool_dir/node_modules/@hono/zod-validator" ../auth-hono/node_modules/@hono/zod-validator; ln -sfn "$$tool_dir/node_modules/@simplewebauthn/server" ../auth-hono/node_modules/@simplewebauthn/server; trap "rm -rf node_modules ../auth-hono/node_modules" EXIT; if [ -n "$$scope" ]; then "$$tool_dir/node_modules/.bin/vitest" run "$$scope" --environment node; else "$$tool_dir/node_modules/.bin/vitest" run tests --environment node; fi'
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/auth-client $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules ../auth-hono/node_modules'

.PHONY: test-auth-ui
test-auth-ui: ## Run @sentropic/auth-ui tests
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/auth-ui $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/auth-ui $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; scope="$(SCOPE)"; scope="$${scope#packages/auth-ui/}"; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node @simplewebauthn/browser@13.2.2 >/dev/null; mkdir -p node_modules; ln -sfn "$$tool_dir/node_modules/@simplewebauthn" node_modules/@simplewebauthn; ln -sfn "$$tool_dir/node_modules/vitest" node_modules/vitest; trap "rm -rf node_modules" EXIT; if [ -n "$$scope" ]; then "$$tool_dir/node_modules/.bin/vitest" run "$$scope" --environment node; else "$$tool_dir/node_modules/.bin/vitest" run tests --environment node; fi'

.PHONY: test-packages
test-packages: ## Run package tests by SCOPE path
	@if [ -z "$(SCOPE)" ]; then \
		echo "Usage: make test-packages SCOPE=packages/auth-ui/tests/<file> ENV=<env>"; \
		exit 2; \
	fi; \
	case "$(SCOPE)" in \
		packages/auth-ui|packages/auth-ui/*) $(MAKE) test-auth-ui SCOPE="$(SCOPE)" ENV=$(ENV) ;; \
		*) echo "Unsupported package SCOPE: $(SCOPE)"; exit 2 ;; \
	esac

.PHONY: test-pkg-chat-core
test-pkg-chat-core: ## Run @sentropic/chat-core unit tests with coverage
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/chat-core $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules coverage'
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/chat-core $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.0.18 @vitest/coverage-v8@4.0.18 typescript@5.4.5 @types/node >/dev/null; mkdir -p node_modules/@vitest; ln -sfn "$$tool_dir/node_modules/vitest" node_modules/vitest; ln -sfn "$$tool_dir/node_modules/@vitest/coverage-v8" node_modules/@vitest/coverage-v8; trap "rm -rf node_modules" EXIT; "$$tool_dir/node_modules/.bin/vitest" run tests --environment node --coverage'
.PHONY: test-skills
test-skills: ## Run @sentropic/skills tests
		@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/skills $(SKILLS_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node gray-matter@4.0.3 zod@3.23.8 isolated-vm@6.1.2 docx@9.5.1 pptxgenjs@4.0.1 >/dev/null; ln -s "$$tool_dir/node_modules" node_modules; trap "rm -f node_modules" EXIT; NODE_PATH="$$tool_dir/node_modules" "$$tool_dir/node_modules/.bin/vitest" run tests --environment node'

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
	  curl -sf $(API_BASE_URL)/api/v1/health >/dev/null && curl -sf $(UI_BASE_URL) >/dev/null && exit 0; \
	  echo "Waiting for services... ($$i/30)"; sleep 2; \
	done; echo "Services not ready"; exit 1'

.PHONY: wait-ready-api
wait-ready-api:
	@echo "⏳ Checking API readiness..."
	@bash -c 'for i in {1..30}; do \
	  curl -sf $(API_BASE_URL)/api/v1/health >/dev/null && exit 0; \
	  echo "Waiting for API... ($$i/30)"; sleep 2; \
	done; echo "API not ready"; exit 1'

.PHONY: build-e2e
build-e2e:
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.test.yml build e2e

.PHONY: save-e2e
save-e2e:
	@echo "💾 Saving E2E image as artifact..."
	@docker save $(REGISTRY)/$(E2E_IMAGE_NAME):$(E2E_VERSION) -o e2e-image.tar

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
E2E_GROUPS ?= 00 01 02 03 04 05 06 07

.PHONY: test-e2e
test-e2e: up-e2e wait-ready db-seed-test e2e-set-queue ## Run E2E tests with Playwright (scope with E2E_SPEC)
	# Options:
	# - WORKERS (default: 4)
	# - RETRIES (default: 0)        -> force "fail fast" (no retries)
	# - MAX_FAILURES (optional)    -> if set, pass --max-failures=<n> (otherwise show all failures)
	# - QUEUE_CONCURRENCY (default: 30) -> upsert settings.ai_concurrency before running tests
	# - QUEUE_PROCESSING_INTERVAL (optional) -> upsert settings.queue_processing_interval (ms)
	# - E2E_GROUPS (default: "00 01 02 03 04 05 06 07") -> list of groups to run
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.test.yml run --rm --no-deps \
	  -e E2E_SPEC -e WORKERS -e RETRIES -e MAX_FAILURES -e E2E_GROUPS="$(E2E_GROUPS)" \
	  e2e sh -lc ' \
	    workers="$${WORKERS:-4}"; \
	    retries="$${RETRIES:-2}"; \
	    max_fail="$${MAX_FAILURES:-}"; \
	    extra=""; \
	    if [ -n "$$max_fail" ]; then extra="--max-failures=$$max_fail"; fi; \
	    if [ -n "$$E2E_SPEC" ]; then \
	      spec_path="$$E2E_SPEC"; \
	      spec_path="$${spec_path#e2e/}"; \
	      echo "▶ Running scoped Playwright: $$spec_path (workers=$$workers retries=$$retries $${extra:-})"; \
	      npx playwright test "$$spec_path" --workers="$$workers" --retries="$$retries" $$extra; \
	    else \
	      echo "▶ Running Playwright by groups: $$E2E_GROUPS (workers=$$workers retries=$$retries $${extra:-})"; \
	      for g in $$E2E_GROUPS; do \
	        for pattern in "tests/$${g}-.*.spec.ts"; do \
	          echo "▶ Running group $$g: $$pattern"; \
	          npx playwright test "$$pattern" --workers="$$workers" --retries="$$retries" $$extra; \
	        done; \
	      done; \
	    fi'
	@echo "🛑 Stopping services..."
	# @$(DOCKER_COMPOSE) down

.PHONY: test-e2e-vscode
test-e2e-vscode: up-e2e-vscode wait-ready db-seed-test e2e-set-queue ## Run VSCode E2E lane (requires E2E_SPEC)
	@if [ -z "$$E2E_SPEC" ]; then \
	  echo "❌ E2E_SPEC is required (example: tests/vscode/01-vscode-chat-streaming.spec.ts)"; \
	  exit 2; \
	fi
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.test.yml -f docker-compose.e2e-vscode.yml run --rm --no-deps \
	  -e E2E_SPEC -e WORKERS -e RETRIES -e MAX_FAILURES -e OPENVSCODE_BASE_URL="http://localhost:$${OPENVSCODE_PORT:-3115}" \
	  e2e-vscode sh -lc ' \
	    workers="$${WORKERS:-2}"; \
	    retries="$${RETRIES:-1}"; \
	    max_fail="$${MAX_FAILURES:-}"; \
	    extra=""; \
	    if [ -n "$$max_fail" ]; then extra="--max-failures=$$max_fail"; fi; \
	    spec_path="$${E2E_SPEC#e2e/}"; \
	    echo "▶ Running VSCode scoped Playwright: $$spec_path (workers=$$workers retries=$$retries $${extra:-})"; \
	    npx playwright test "$$spec_path" --workers="$$workers" --retries="$$retries" $$extra'
	@echo "🛑 Stopping VSCode E2E services..."
	# @$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.test.yml -f docker-compose.e2e-vscode.yml down

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
	@docker volume rm $(COMPOSE_PROJECT_NAME)_pg_data || true
	@echo "✅ Database cleaned!"
	@echo "🚀 Restarting services..."

.PHONY: clean-node-modules
clean-node-modules: ## Remove workspace node_modules (root-owned cruft from containerized runs); next stack bringup reinstalls
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace $(LLM_MESH_NODE_IMAGE) sh -lc 'rm -rf node_modules api/node_modules ui/node_modules packages/*/node_modules'

# -----------------------------------------------------------------------------
# Development environment
# -----------------------------------------------------------------------------
.PHONY: prepare-node-workspace
prepare-node-workspace: build-llm-mesh build-flow build-oauth-verify build-mcp-auth build-auth-hono build-auth-client build-comments build-ubo-contracts ## Prepare mounted workspace node_modules and package dist for dev/test runtime
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml build api
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps api sh -lc 'chown -R '"$$(id -u):$$(id -g)"' /workspace/node_modules 2>/dev/null || true'
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache api sh -lc 'cd /workspace && npm ci --workspaces --include-workspace-root --ignore-scripts --audit=false'

.PHONY: dev
dev: prepare-node-workspace ## Start UI and API in watch mode
	DISABLE_RATE_LIMIT=true $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up --build -d

.PHONY: dev-ui
dev-ui:
	$(DOCKER_COMPOSE) up --build ui

.PHONY: dev-api
dev-api: prepare-node-workspace
	$(DOCKER_COMPOSE) up --build api

.PHONY: up
up: prepare-node-workspace ## Start the full stack in detached mode
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up --build -d --wait

.PHONY: up-e2e
up-e2e: ## Start stack with test overrides (UI env for API URL)
	DISABLE_RATE_LIMIT=true ADMIN_EMAIL=e2e-admin@example.com TARGET=production $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.test.yml up -d

.PHONY: up-e2e-vscode
up-e2e-vscode: ## Start VSCode E2E stack (api/ui/e2e/openvscode)
	DISABLE_RATE_LIMIT=true ADMIN_EMAIL=e2e-admin@example.com TARGET=production $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.test.yml -f docker-compose.e2e-vscode.yml up -d

.PHONY: down-e2e-vscode
down-e2e-vscode: ## Stop VSCode E2E stack
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.test.yml -f docker-compose.e2e-vscode.yml down

.PHONY: ps-e2e-vscode
ps-e2e-vscode: ## Show VSCode E2E services
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.test.yml -f docker-compose.e2e-vscode.yml ps

.PHONY: logs-e2e-vscode
logs-e2e-vscode: ## Stream VSCode E2E logs
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.test.yml -f docker-compose.e2e-vscode.yml logs -f

.PHONY: up-api
up-api: prepare-node-workspace ## Start the api stack in detached mode
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up --build -d api --wait api

.PHONY: up-api-test
up-api-test: prepare-node-workspace ## Start the api stack in detached mode with DISABLE_RATE_LIMIT=true
	DISABLE_RATE_LIMIT=true $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up --build -d api --wait api

.PHONY: up-api-test-ci
up-api-test-ci: build-llm-mesh build-flow build-oauth-verify build-mcp-auth build-auth-hono build-auth-client build-comments build-ubo-contracts ## Start the api stack in detached mode for CI (reuse prebuilt API image, no rebuild)
	DISABLE_RATE_LIMIT=true $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm api sh -lc 'chown -R '"$$(id -u):$$(id -g)"' /workspace/node_modules 2>/dev/null || true'
	DISABLE_RATE_LIMIT=true $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache api sh -lc 'cd /workspace && npm ci --workspaces --include-workspace-root && cd /workspace/api && npm run db:migrate'
	DISABLE_RATE_LIMIT=true $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml up -d api --wait api

.PHONY: up-ui
up-ui: ## Start the ui stack in detached mode
	TARGET=development $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up --build -d ui --wait ui

.PHONY: down
down: ## Stop and remove containers, networks, volumes
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml down

# -----------------------------------------------------------------------------
# Standalone IdP (BR-39m Phase A0 — exception BR39m-EX1)
# Reuses the api image + shared postgres; no new DB, no migration ownership.
# -----------------------------------------------------------------------------
.PHONY: typecheck-idp
typecheck-idp: ## Typecheck the standalone IdP composition (apps/auth-idp)
	@$(DOCKER_COMPOSE) -f docker-compose.yml run --rm --no-deps -w /workspace api npx tsc --noEmit --project apps/auth-idp/tsconfig.json

# BR-39m A0-bis — minimal IdP screens front (apps/auth-idp/web). Self-contained
# sub-project (NOT a root workspace member; same isolation as e2e/). It pulls
# @sentropic/auth-ui via a relative file: dependency, so the package source is
# present in the mounted workspace at install time.
.PHONY: lock-idp-web
lock-idp-web: ## Update apps/auth-idp/web package-lock.json using a Node container
	@echo "🔒 Updating apps/auth-idp/web package-lock.json..."
	docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
		-v "$$(pwd):/workspace" \
		-w /workspace/apps/auth-idp/web \
		node:24-alpine \
		sh -lc "npm install --package-lock-only --ignore-scripts --no-audit --no-fund"

.PHONY: install-idp-web
install-idp-web: ## Install the IdP screens front deps into the mounted workspace
	docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
		-v "$$(pwd):/workspace" \
		-w /workspace/apps/auth-idp/web \
		node:24-alpine \
		sh -lc "if [ -f package-lock.json ]; then npm ci --ignore-scripts --no-audit --no-fund; else npm install --ignore-scripts --no-audit --no-fund; fi"

.PHONY: typecheck-idp-web
typecheck-idp-web: install-idp-web ## Typecheck the IdP screens front
	docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
		-v "$$(pwd):/workspace" \
		-w /workspace/apps/auth-idp/web \
		node:24-alpine \
		sh -lc "npm run typecheck"

.PHONY: build-idp-web
build-idp-web: install-idp-web ## Build the IdP screens static front to apps/auth-idp/web/build
	docker run --rm \
		-u "$$(id -u):$$(id -g)" \
		-e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
		-v "$$(pwd):/workspace" \
		-w /workspace/apps/auth-idp/web \
		node:24-alpine \
		sh -lc "npm run build"
	@test -f apps/auth-idp/web/build/404.html || (echo "❌ IdP front build missing SPA fallback 404.html" && exit 1)
	@echo "✅ IdP screens front built at apps/auth-idp/web/build (SPA fallback: 404.html)"

.PHONY: dev-idp
dev-idp: prepare-node-workspace build-idp-web ## Start the standalone IdP (screens + API) on the shared DB (slot 4 ports)
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up -d postgres --wait postgres
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps \
		-e OAUTH_SIGNING_KEK=$${OAUTH_SIGNING_KEK:-dev-idp-signing-kek-change-in-production} \
		api sh -lc 'cd /workspace/api && npm run db:migrate && npm run oauth:seed-clients && npm run oauth:init-keys'
	DISABLE_RATE_LIMIT=true $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.idp.yml up -d auth-idp --wait auth-idp

.PHONY: seed-idp-clients
seed-idp-clients: ## Seed the design-system oauth client on the shared DB
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps api sh -lc 'cd /workspace/api && npm run oauth:seed-clients'

.PHONY: down-idp
down-idp: ## Stop and remove the standalone IdP overlay (+ shared dev/test stack)
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml -f docker-compose.idp.yml down

.PHONY: logs-idp
logs-idp: ## Stream standalone IdP logs
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.idp.yml logs -f auth-idp

.PHONY: logs-idp-once
logs-idp-once: ## Print standalone IdP logs (no follow)
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.idp.yml logs --no-color auth-idp

.PHONY: exec-idp
exec-idp: ## Exec a command in the running auth-idp container: make exec-idp CMD="node -v"
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.idp.yml exec auth-idp sh -lc "$$CMD"

.PHONY: ps-idp
ps-idp: ## Show standalone IdP service status
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.idp.yml ps

.PHONY: smoke-idp
smoke-idp: ## Run the deterministic SSO authorization_code smoke against the live IdP (needs make dev-idp)
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.idp.yml run --rm --no-deps \
		-e IDP_BASE_URL=http://auth-idp:8787 \
		-e JWT_SECRET=$${JWT_SECRET:-dev-idp-jwt-secret-change-in-production} \
		-w /workspace api npx tsx apps/auth-idp/sso-smoke.ts

.PHONY: smoke-idp-screens
smoke-idp-screens: ## Screen-driven SSO smoke: drives the IdP-SERVED login+consent screens (needs make dev-idp)
	@echo "▶ Pinning the IdP UI origin to the in-network name (auth-idp:8787) so the browser can follow login/consent redirects..."
	@IDP_ORIGIN=http://auth-idp:8787 DISABLE_RATE_LIMIT=true \
		$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.idp.yml up -d auth-idp --wait auth-idp
	@echo "▶ Seeding verified user + session on the shared DB..."
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.idp.yml run --rm --no-deps \
		-e JWT_SECRET=$${JWT_SECRET:-dev-idp-jwt-secret-change-in-production} \
		-w /workspace api npx tsx apps/auth-idp/screen-smoke-seed.ts > .tmp-idp-seed.env 2>/dev/null; \
	USER_ID=$$(grep '^USER_ID=' .tmp-idp-seed.env | cut -d= -f2-); \
	SESSION_TOKEN=$$(grep '^SESSION_TOKEN=' .tmp-idp-seed.env | cut -d= -f2-); \
	rm -f .tmp-idp-seed.env; \
	if [ -z "$$USER_ID" ] || [ -z "$$SESSION_TOKEN" ]; then echo "❌ seed step did not produce USER_ID/SESSION_TOKEN"; exit 1; fi; \
	echo "▶ Driving the IdP-served screens in headless Chromium..."; \
	USER_ID="$$USER_ID" SESSION_TOKEN="$$SESSION_TOKEN" \
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.idp.yml --profile idp-smoke run --rm --no-deps \
		-e IDP_BASE_URL=http://auth-idp:8787 \
		-e USER_ID="$$USER_ID" \
		-e SESSION_TOKEN="$$SESSION_TOKEN" \
		idp-screen-smoke


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

.PHONY: exec-%
exec-%: ## Exec a command in the running api or ui container: make exec-api CMD="node -v"
	@if [ -z "$$CMD" ]; then \
		echo "Usage: make exec-<ui/api> CMD=\"<command>\""; \
		exit 2; \
	fi
	@if [ "$$(docker compose -f docker-compose.yml -f docker-compose.dev.yml ps -q $* 2>/dev/null | wc -l)" -eq 0 ]; then \
		echo "$* container is not running. Start it first (e.g. make up / make dev / make up-api-test)."; \
		exit 1; \
	fi
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec $* sh -lc "$$CMD"

.PHONY: exec-%-sh
exec-%-sh: ## Open a shell in the running api container
	@if [ "$$(docker compose -f docker-compose.yml -f docker-compose.dev.yml ps -q $* 2>/dev/null | wc -l)" -eq 0 ]; then \
		echo "$* container is not running. Start it first (e.g. make up / make dev ...)."; \
		exit 1; \
	fi
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec $* sh

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

.PHONY: db-generate-control
db-generate-control: ## Generate control-schema migration files (control migration stream; BR-60 ARCH-14)
	@if [ "$$(docker compose -f docker-compose.yml -f docker-compose.dev.yml ps -q api 2>/dev/null | wc -l)" -gt 0 ]; then \
		$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec api npm run db:generate-control; \
	else \
		$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml run --rm api sh -lc "npm ci --include=dev && npm run db:generate-control"; \
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
		SELECT 'initiatives' as table_name, COUNT(*) as count FROM initiatives \
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

.PHONY: db-inspect-initiatives
db-inspect-initiatives: up ## Inspect initiatives and folders relationship
	@echo "📊 Initiatives Details:"
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T postgres psql -U app -d app -c "\
		SELECT i.id, i.name, i.folder_id, f.name as folder_name, i.organization_id, o.name as organization_name \
		FROM initiatives i \
		LEFT JOIN folders f ON i.folder_id = f.id \
		LEFT JOIN organizations o ON i.organization_id = o.id \
		ORDER BY i.created_at DESC \
		LIMIT 20;"

.PHONY: db-inspect-folders
db-inspect-folders: up ## Inspect folders and their initiatives count
	@echo "📊 Folders Details:"
	@$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T postgres psql -U app -d app -c "\
		SELECT f.id, f.name, f.description, COUNT(i.id) as initiatives_count \
		FROM folders f \
		LEFT JOIN initiatives i ON f.id = i.folder_id \
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
db-backup-prod: backup-dir ## Backup the k8s production database to a local dump (uses KUBECONFIG; feeds the pre-merge migration test)
	@echo "💾 Creating backup from the k8s production database (namespace $(K8S_NAMESPACE))..."
	@if [ -z "$(KUBECONFIG)" ]; then \
		echo "❌ Error: KUBECONFIG must be set (path to the poc cluster kubeconfig)"; \
		exit 1; \
	fi
	@set -eu ; TIMESTAMP=$$(date +%Y-%m-%dT%H-%M-%S); \
	BACKUP_FILE="data/backup/prod-$${TIMESTAMP}.dump"; \
	echo "▶ Backing up to $${BACKUP_FILE}..."; \
	POD=$$(KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) get pods -l app.kubernetes.io/name=sentropic,app.kubernetes.io/component=postgres -o jsonpath='{.items[0].metadata.name}'); \
	test -n "$$POD" || { echo "❌ Error: no postgres pod found in namespace $(K8S_NAMESPACE)"; exit 1; }; \
	PGPASSWORD=$$(KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) get secret sentropic-postgres -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d); \
	KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) exec -i "$$POD" -- env PGPASSWORD="$$PGPASSWORD" pg_dump -h 127.0.0.1 -U app -d app -F c > "$$BACKUP_FILE"; \
	test -s "$$BACKUP_FILE" || { echo "❌ Error: backup is empty — k8s pg_dump failed"; rm -f "$$BACKUP_FILE"; exit 1; }; \
	echo "✅ Backup created: $${BACKUP_FILE} ($$(wc -c < "$$BACKUP_FILE") bytes)"

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
		SELECT 'initiatives' as table_name, COUNT(*) as count FROM initiatives \
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

# -----------------------------------------------------------------------------
# Document storage backup/restore (MinIO / S3)

DOC_BUCKET ?= $(or $(DOC_STORAGE_BUCKET),sentropic-docs-dev)
DOC_SOURCE ?= prod

# Note: mc mirror is not an atomic S3 snapshot — it lists objects at start then copies them.
# Objects created after listing starts are excluded, but an object mid-upload at list time
# may be partially copied. For write-once documents this is safe in practice.

MINIO_EXEC = $(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -T --user $$(id -u):$$(id -g) -e MC_CONFIG_DIR=/tmp/.mc-$$$$ minio

.PHONY: doc-backup
doc-backup: backup-dir up ## Backup local documents to file
	@echo "💾 Creating backup from local documents..."
	@TIMESTAMP=$$(date +%Y-%m-%dT%H-%M-%S); \
	BACKUP_FILE="data/backup/docs-app-$${TIMESTAMP}.tar.gz"; \
	echo "▶ Backing up to $${BACKUP_FILE}..."; \
	$(MINIO_EXEC) sh -c "\
		mc alias set local http://localhost:9000 \$${MINIO_ROOT_USER:-minioadmin} \$${MINIO_ROOT_PASSWORD:-minioadmin} --api s3v4 2>/dev/null; \
		rm -rf /backups/tmp/docs-$${TIMESTAMP} && mkdir -p /backups/tmp/docs-$${TIMESTAMP}; \
		mc mirror --overwrite local/$(DOC_BUCKET) /backups/tmp/docs-$${TIMESTAMP}/ \
	" && \
	cd data/backup/tmp/docs-$${TIMESTAMP} && tar czf ../../docs-app-$${TIMESTAMP}.tar.gz . && cd ../../../.. && \
	rm -rf data/backup/tmp/docs-$${TIMESTAMP} && \
	echo "✅ Backup created: $${BACKUP_FILE}"

.PHONY: doc-backup-prod
doc-backup-prod: backup-dir up ## Backup production documents to local file (uses DOC_STORAGE_*_PROD from .env)
	@echo "💾 Creating backup from production documents..."
	@if [ -z "$$DOC_STORAGE_ENDPOINT_PROD" ]; then \
		echo "❌ Error: DOC_STORAGE_ENDPOINT_PROD must be set in .env file"; \
		exit 1; \
	fi
	@TIMESTAMP=$$(date +%Y-%m-%dT%H-%M-%S); \
	BACKUP_FILE="data/backup/docs-prod-$${TIMESTAMP}.tar.gz"; \
	echo "▶ Backing up to $${BACKUP_FILE}..."; \
	$(MINIO_EXEC) sh -c "\
		mc alias set prodstore $$DOC_STORAGE_ENDPOINT_PROD $$DOC_STORAGE_ACCESS_KEY_PROD $$DOC_STORAGE_SECRET_KEY_PROD --api s3v4 2>/dev/null; \
		rm -rf /backups/tmp/docs-$${TIMESTAMP} && mkdir -p /backups/tmp/docs-$${TIMESTAMP}; \
		mc mirror --overwrite prodstore/$$DOC_STORAGE_BUCKET_NAME_PROD /backups/tmp/docs-$${TIMESTAMP}/ \
	" && \
	cd data/backup/tmp/docs-$${TIMESTAMP} && tar czf ../../docs-prod-$${TIMESTAMP}.tar.gz . && cd ../../../.. && \
	rm -rf data/backup/tmp/docs-$${TIMESTAMP} && \
	echo "✅ Backup created: $${BACKUP_FILE}"

.PHONY: doc-restore
doc-restore: up ## Restore document backup to local MinIO [BACKUP_FILE=filename.tar.gz]
	@if [ -z "$(BACKUP_FILE)" ]; then \
		echo "❌ Error: BACKUP_FILE must be specified (e.g., BACKUP_FILE=docs-prod-2026-03-22T12-00-00.tar.gz or BACKUP_FILE=docs-app-2026-03-22T12-00-00.tar.gz)"; \
		echo "Available backups:"; \
		ls -1 data/backup/docs-*.tar.gz 2>/dev/null | sed 's|data/backup/||' | awk '{print "  BACKUP_FILE=" $$1}' || echo "  No backups found"; \
		exit 1; \
	fi
	@if [ ! -f "data/backup/$(BACKUP_FILE)" ]; then \
		echo "❌ Error: Backup file not found: data/backup/$(BACKUP_FILE)"; \
		exit 1; \
	fi
	@echo "📥 Restoring documents from $(BACKUP_FILE)..."
	@TMPNAME="doc-restore-$$(date +%s)"; \
	mkdir -p data/backup/tmp/$$TMPNAME && \
	tar xzf data/backup/$(BACKUP_FILE) -C data/backup/tmp/$$TMPNAME && \
	$(MINIO_EXEC) sh -c "\
		mc alias set local http://localhost:9000 \$${MINIO_ROOT_USER:-minioadmin} \$${MINIO_ROOT_PASSWORD:-minioadmin} --api s3v4 2>/dev/null; \
		mc mb --ignore-existing local/$(DOC_BUCKET); \
		mc mirror --overwrite /backups/tmp/$$TMPNAME/ local/$(DOC_BUCKET)/ \
	" && \
	rm -rf data/backup/tmp/$$TMPNAME
	@echo "✅ Documents restored to local bucket $(DOC_BUCKET)"

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
	$(DOCKER_COMPOSE) exec api sh -lc 'if [ -f dist/tests/utils/seed-test-data.js ]; then node dist/tests/utils/seed-test-data.js; else npx tsx tests/utils/seed-test-data.ts; fi'

.PHONY: db-migrate-data
db-migrate-data: ## Migrate initiatives data to JSONB data field
	$(COMPOSE_RUN_API) npm run db:migrate-data

.PHONY: db-create-indexes
db-create-indexes: ## Create recommended indexes for initiatives table
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
	@echo "  📋 Step 1: Executing SCA scan..."
	@if [ "$*" = "api" ] || [ "$*" = "ui" ]; then \
		docker run --rm -v "${PWD}:/workspace" -w /workspace node:24-alpine3.23 sh -lc "npm audit --json || true" > .security/sca-$*.json; \
	else \
		docker run --rm -v "${PWD}/$*:/src" aquasec/trivy fs --security-checks vuln --severity HIGH,CRITICAL --format json --quiet /src > .security/sca-$*.json || true; \
	fi
	@echo "  📋 Step 2: Parsing results to structured format..."
	@bash scripts/security/security-parser.sh sca .security/sca-$*.json .security/sca-$*-parsed.yaml $* || exit 1
	@echo "  📋 Step 3: Checking compliance against vulnerability register..."
	@bash scripts/security/security-compliance.sh sca $* || exit 1
	@echo "✅ SCA scan completed for $*"

.PHONY: test-%-security-container
test-%-security-container: ## Run container scan (Trivy) on service image (usage: make test-api-security-container, make test-ui-security-container)
	@echo "🔒 Security: Running container scan on $*..."
	@mkdir -p .security
	@echo "  📋 Step 1: Executing container scan..."
	@if [ "$*" = "api" ]; then \
		IMAGE_NAME="$(REGISTRY)/$(API_IMAGE_NAME):$(API_VERSION)"; \
		echo "  Scanning image: $$IMAGE_NAME"; \
		docker run --rm "$$IMAGE_NAME" sh -lc "npm audit --omit=dev --json || true" > .security/container-$*.json; \
	elif [ "$*" = "ui" ]; then \
		IMAGE_NAME="$(REGISTRY)/$(UI_IMAGE_NAME):$(UI_VERSION)"; \
		echo "  Scanning image: $$IMAGE_NAME"; \
		docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy image --severity HIGH,CRITICAL --format json --quiet $$IMAGE_NAME > .security/container-$*.json || (echo '{"Results": []}' > .security/container-$*.json && echo "  ⚠️  Image not found: $$IMAGE_NAME"); \
	else \
		IMAGE_NAME="sentropic-$*:latest"; \
		echo "  Scanning image: $$IMAGE_NAME"; \
		docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy image --severity HIGH,CRITICAL --format json --quiet $$IMAGE_NAME > .security/container-$*.json || (echo '{"Results": []}' > .security/container-$*.json && echo "  ⚠️  Image not found: $$IMAGE_NAME"); \
	fi; \
	true
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
API_TEST_WORKERS ?= 4
API_TEST_ARGS ?=

.PHONY: test-api-%

test-api-%: ## Run API tests (usage: make test-api-unit, make test-api-queue, SCOPE=admin make test-api-unit)
	@$(DOCKER_COMPOSE) exec -T -e SCOPE="$(SCOPE)" -e VITEST_MAX_WORKERS="$(API_TEST_WORKERS)" -e API_TEST_ARGS="$(API_TEST_ARGS)" api sh -lc ' \
	  TEST_TYPE="$*"; \
	  requested_workers="$${VITEST_MAX_WORKERS:-4}"; \
	  extra_args="$${API_TEST_ARGS:-}"; \
	  workers=1; \
	  cleanup_scope=global; \
	  if [ "$$TEST_TYPE" = "smoke" ] || [ "$$TEST_TYPE" = "endpoints" ]; then \
	    workers="$$requested_workers"; \
	  fi; \
	  if [ "$$workers" != "1" ]; then \
	    cleanup_scope=tracked; \
	  fi; \
	  export VITEST_MAX_WORKERS="$$workers"; \
	  export TEST_CLEANUP_SCOPE="$$cleanup_scope"; \
	  if [ -n "$$SCOPE" ]; then \
	    echo "▶ Running scoped $$TEST_TYPE tests: $$SCOPE (workers=$$workers, cleanup=$$cleanup_scope, args=$${extra_args:-<none>})"; \
	    if [ -n "$$extra_args" ]; then \
	      npx vitest run $$SCOPE $$extra_args; \
	    else \
	      npx vitest run $$SCOPE; \
	    fi; \
	  else \
	    echo "▶ Running all $$TEST_TYPE tests (workers=$$workers, cleanup=$$cleanup_scope, args=$${extra_args:-<none>})"; \
	    if [ -n "$$extra_args" ]; then \
	      npm run test:$$TEST_TYPE -- $$extra_args; \
	    else \
	      npm run test:$$TEST_TYPE; \
	    fi; \
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
	@curl -X POST $(API_BASE_URL)/api/v1/queue/purge -H "Content-Type: application/json" -d '{"status": "force"}' || echo "API not available, using fallback"
	@echo "✅ Queue cleared"

queue-status: ## Show current queue status
	@echo "📊 Queue status:"
	@curl -s $(API_BASE_URL)/api/v1/queue/stats | jq . || echo "API not available"

queue-reset: queue-clear ## Reset queue and clear all jobs (alias for queue-clear)

.PHONY: up-maildev
up-maildev: ## Start MailDev service in detached mode
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up -d maildev

.PHONY: down-maildev
down-maildev: ## Stop MailDev service
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml stop maildev

# === Scaleway Kubernetes (poc-k8s tenant) =================================
# Tenant-scoped Make targets. The namespace + ResourceQuota + LimitRange +
# NetworkPolicy baseline are NOT applied here; they live in
# https://github.com/rhanka/poc-k8s/tree/main/tenants/sentropic — run
# `make -C ~/src/poc-k8s apply-sentropic` first.
# All targets honour KUBECONFIG (default ~/.kube/poc.yaml).
K8S_NAMESPACE ?= sentropic
K8S_PREPROD_NAMESPACE ?= sentropic-preprod
K8S_ENV_FILE  ?= .env
KUBECONFIG    ?= $(HOME)/.kube/poc.yaml
SCW_REGISTRY_SECRET ?= sentropic-registry
K8S_LOG_SELECTOR ?= app.kubernetes.io/name=sentropic,app.kubernetes.io/component=api
K8S_LOG_TAIL ?= 200
K8S_LOG_PREVIOUS ?= 0
K8S_API_SMOKE_PORT ?= 18787
K8S_UI_SMOKE_PORT ?= 15173
K8S_EMAIL_SMOKE_TO ?=
K8S_EMAIL_SMOKE_TIMEOUT ?= 160
K8S_NETCHECK_HOST ?= smtp.tem.scaleway.com
K8S_NETCHECK_PORT ?= 465
K8S_NETCHECK_TIMEOUT ?= 8000
GH_REPO ?= rhanka/sentropic
GH_K8S_SECRET_NAME ?= KUBECONFIG_B64
GH_DEPLOY_RUN_ID ?=

.PHONY: k8s-deploy k8s-deploy-preprod k8s-undeploy k8s-bundle-secret k8s-registry-secret k8s-status k8s-debug k8s-logs k8s-smoke k8s-api-netcheck k8s-email-smoke gh-k8s-secret gh-k8s-secret-check gh-k8s-rerun-deploy gh-k8s-watch

k8s-deploy: ## Apply the prod overlay (kustomize) on the poc cluster — ingress is part of the overlay
	# BR-55a: one kustomize apply (base + overlays/prod). The standalone IdP
	# (auth.sent-tech.ca) runs from the SAME api image; the api owns migrations on the
	# shared DB and the IdP runs none of its own. The prod overlay sets
	# namespace=sentropic and includes the ingress (the old K8S_INGRESS gate is gone).
	# Image = base default (:main) until the release pipeline pins a tag (BR-55c/d).
	KUBECONFIG=$(KUBECONFIG) kubectl apply -k deploy/k8s/overlays/prod
	-KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) delete deployment/maildev service/maildev networkpolicy/allow-api-to-maildev --ignore-not-found
	KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) rollout restart deployment/api deployment/auth-idp deployment/ui
	KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) rollout status deploy/api      --timeout=300s
	KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) rollout status deploy/auth-idp --timeout=300s
	KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) rollout status deploy/ui       --timeout=300s

k8s-deploy-preprod: ## BR-55c: deploy main->preprod (ns sentropic-preprod) with the immutable content-hash image pin. NEVER touches the prod (sentropic) ns.
	# BR-55c (D-c1/D-c4): pin the immutable per-content image tags (API_VERSION/UI_VERSION
	# = content sha1 — the SAME tags publish-{api,ui}-image push) into the preprod overlay,
	# then apply. This kills the floating :main staleness. The preprod-scoped KUBECONFIG
	# (poc-k8s, namespace-scoped to sentropic-preprod) can ONLY write this ns — the prod
	# `sentropic` ns is unreachable. The auth-idp shares the api image, so pinning the api
	# image covers it. Idempotent: the images: block is appended once per checkout.
	@grep -q '^images:' deploy/k8s/overlays/preprod/kustomization.yaml || printf '\nimages:\n  - name: %s/%s\n    newTag: "%s"\n  - name: %s/%s\n    newTag: "%s"\n' "$(REGISTRY)" "$(API_IMAGE_NAME)" "$(API_VERSION)" "$(REGISTRY)" "$(UI_IMAGE_NAME)" "$(UI_VERSION)" >> deploy/k8s/overlays/preprod/kustomization.yaml
	KUBECONFIG=$(KUBECONFIG) kubectl apply -k deploy/k8s/overlays/preprod
	KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_PREPROD_NAMESPACE) rollout status deploy/api      --timeout=300s
	KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_PREPROD_NAMESPACE) rollout status deploy/auth-idp --timeout=300s
	KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_PREPROD_NAMESPACE) rollout status deploy/ui       --timeout=300s

k8s-undeploy: ## Delete the tenant workload (namespace + quotas owned by poc-k8s stay)
	-KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) delete deployment/maildev service/maildev networkpolicy/allow-api-to-maildev --ignore-not-found
	-KUBECONFIG=$(KUBECONFIG) kubectl delete -k deploy/k8s/overlays/prod --ignore-not-found
	-KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) delete secret sentropic-postgres sentropic-api --ignore-not-found

k8s-bundle-secret: ## Create/update the namespace Secrets from $(K8S_ENV_FILE) (.env)
	@test -f $(K8S_ENV_FILE) || { echo "missing $(K8S_ENV_FILE)" >&2; exit 1; }
	@set -eu ; \
	get() { awk -v key="$$1" '\
		BEGIN { value = "" } \
		{ \
			line = $$0; \
			sub(/\r$$/, "", line); \
			if (line ~ /^[[:space:]]*#/) next; \
			sub(/^[[:space:]]*export[[:space:]]+/, "", line); \
			if (index(line, key "=") == 1) { \
				value = substr(line, length(key) + 2); \
				sub(/[[:space:]]+#.*$$/, "", value); \
				gsub(/^"/, "", value); \
				gsub(/"$$/, "", value); \
			} \
		} \
		END { printf "%s", value }' "$(K8S_ENV_FILE)" ; } ; \
	get_poc_export() { awk -v key="$$1" '\
		BEGIN { value = "" } \
		{ \
			line = $$0; \
			sub(/\r$$/, "", line); \
			if (line !~ /^[[:space:]]*#[[:space:]]*export[[:space:]]+/) next; \
			sub(/^[[:space:]]*#[[:space:]]*export[[:space:]]+/, "", line); \
			if (index(line, key "=") == 1) { \
				value = substr(line, length(key) + 2); \
				sub(/[[:space:]]+#.*$$/, "", value); \
				gsub(/^"/, "", value); \
				gsub(/"$$/, "", value); \
			} \
		} \
		END { printf "%s", value }' "$(K8S_ENV_FILE)" ; } ; \
	POSTGRES_PASSWORD=$$(get POSTGRES_PASSWORD) ; [ -n "$$POSTGRES_PASSWORD" ] || POSTGRES_PASSWORD=app ; \
	KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) create secret generic sentropic-postgres \
	  --from-literal=POSTGRES_PASSWORD="$$POSTGRES_PASSWORD" \
	  --dry-run=client -o yaml | KUBECONFIG=$(KUBECONFIG) kubectl apply -f - ; \
	OPENAI=$$(get OPENAI_API_KEY) ; ANTHROPIC=$$(get ANTHROPIC_API_KEY) ; GEMINI=$$(get GEMINI_API_KEY) ; \
	MISTRAL=$$(get MISTRAL_API_KEY) ; COHERE=$$(get COHERE_API_KEY) ; TAVILY=$$(get TAVILY_API_KEY) ; \
	GD_CID=$$(get GOOGLE_DRIVE_CLIENT_ID) ; GD_CS=$$(get GOOGLE_DRIVE_CLIENT_SECRET) ; \
	GD_PK=$$(get GOOGLE_DRIVE_PICKER_API_KEY) ; GD_PID=$$(get GOOGLE_DRIVE_PICKER_APP_ID) ; \
	DS_AK=$$(get DOC_STORAGE_ACCESS_KEY) ; DS_SK=$$(get DOC_STORAGE_SECRET_KEY) ; DS_BK=$$(get DOC_STORAGE_BUCKET) ; \
	DS_EP=$$(get DOC_STORAGE_ENDPOINT) ; DS_RG=$$(get DOC_STORAGE_REGION) ; \
	SCW_TEM=$$(get SCW_TEM_SECRET_KEY) ; OAUTH_KEK=$$(get OAUTH_SIGNING_KEK) ; \
	DATABASE_URL=$$(get DATABASE_URL) ; [ -n "$$DATABASE_URL" ] || DATABASE_URL="postgres://app:$${POSTGRES_PASSWORD}@postgres:5432/app" ; \
	KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) create secret generic sentropic-api \
	  --from-literal=DATABASE_URL="$$DATABASE_URL" \
	  --from-literal=OPENAI_API_KEY="$$OPENAI" \
	  --from-literal=ANTHROPIC_API_KEY="$$ANTHROPIC" \
	  --from-literal=GEMINI_API_KEY="$$GEMINI" \
	  --from-literal=MISTRAL_API_KEY="$$MISTRAL" \
	  --from-literal=COHERE_API_KEY="$$COHERE" \
	  --from-literal=TAVILY_API_KEY="$$TAVILY" \
	  --from-literal=DOC_STORAGE_ACCESS_KEY="$$DS_AK" \
	  --from-literal=DOC_STORAGE_SECRET_KEY="$$DS_SK" \
	  --from-literal=DOC_STORAGE_BUCKET="$$DS_BK" \
	  --from-literal=DOC_STORAGE_ENDPOINT="$$DS_EP" \
	  --from-literal=DOC_STORAGE_REGION="$$DS_RG" \
	  --from-literal=GOOGLE_DRIVE_CLIENT_ID="$$GD_CID" \
	  --from-literal=GOOGLE_DRIVE_CLIENT_SECRET="$$GD_CS" \
	  --from-literal=GOOGLE_DRIVE_PICKER_API_KEY="$$GD_PK" \
	  --from-literal=GOOGLE_DRIVE_PICKER_APP_ID="$$GD_PID" \
	  --from-literal=SCW_TEM_SECRET_KEY="$$SCW_TEM" \
	  --from-literal=OAUTH_SIGNING_KEK="$$OAUTH_KEK" \
	  --dry-run=client -o yaml | KUBECONFIG=$(KUBECONFIG) kubectl apply -f - ; \
	S3_AK=$$(get S3_ACCESS_KEY) ; S3_SK=$$(get S3_SECRET_KEY) ; S3_BK=$$(get S3_BUCKET) ; \
	S3_EP=$$(get S3_ENDPOINT) ; S3_RG=$$(get S3_REGION) ; \
	KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) create secret generic sentropic-pgbackup \
	  --from-literal=S3_ACCESS_KEY="$$S3_AK" \
	  --from-literal=S3_SECRET_KEY="$$S3_SK" \
	  --from-literal=S3_BUCKET="$$S3_BK" \
	  --from-literal=S3_ENDPOINT="$$S3_EP" \
	  --from-literal=S3_REGION="$$S3_RG" \
	  --dry-run=client -o yaml | KUBECONFIG=$(KUBECONFIG) kubectl apply -f -
	@echo "==> Secrets sentropic-postgres + sentropic-api + sentropic-pgbackup ready in $(K8S_NAMESPACE)."

k8s-registry-secret: ## Create/update the SCW Registry pull secret from $(K8S_ENV_FILE)
	@test -f $(K8S_ENV_FILE) || { echo "missing $(K8S_ENV_FILE)" >&2; exit 1; }
	@set -eu ; \
	set -a ; source "$(K8S_ENV_FILE)" ; set +a ; \
	registry="$${REGISTRY:?missing REGISTRY in $(K8S_ENV_FILE)}" ; \
	username="$${DOCKER_USERNAME:?missing DOCKER_USERNAME in $(K8S_ENV_FILE)}" ; \
	password="$${SCW_REGISTRY_TOKEN:-$${DOCKER_PASSWORD:-}}" ; \
	[ -n "$$password" ] || { echo "missing SCW_REGISTRY_TOKEN or DOCKER_PASSWORD in $(K8S_ENV_FILE)" >&2; exit 1; } ; \
	registry="$${registry#https://}" ; registry="$${registry#http://}" ; registry="$${registry%%/*}" ; \
	echo "Creating/updating image pull secret $(SCW_REGISTRY_SECRET) in $(K8S_NAMESPACE) for $$registry." ; \
	KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) create secret docker-registry $(SCW_REGISTRY_SECRET) \
	  --docker-server="$$registry" \
	  --docker-username="$$username" \
	  --docker-password="$$password" \
	  --dry-run=client -o yaml | KUBECONFIG=$(KUBECONFIG) kubectl apply -f - ; \
	echo "==> Image pull secret $(SCW_REGISTRY_SECRET) ready in $(K8S_NAMESPACE)."

k8s-status: ## Snapshot of the sentropic tenant on the poc cluster
	@KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) get deploy,statefulset,svc,ingress 2>/dev/null || true
	@echo "" ; KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) get pods -o wide 2>/dev/null || true

k8s-debug: ## Show pod descriptions and recent events for the sentropic tenant
	@echo "==> Pods"
	@KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) get pods -o wide
	@echo ""
	@echo "==> Network policies"
	@KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) get networkpolicy -o wide
	@echo ""
	@echo "==> Pod descriptions"
	@KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) describe pods -l app.kubernetes.io/name=sentropic
	@echo ""
	@echo "==> Recent events"
	@KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) get events --sort-by=.lastTimestamp

k8s-logs: ## Show recent logs for a tenant pod selector (K8S_LOG_SELECTOR=..., K8S_LOG_TAIL=...)
	@if [ "$(K8S_LOG_PREVIOUS)" = "1" ]; then \
	  KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) logs -l "$(K8S_LOG_SELECTOR)" --tail="$(K8S_LOG_TAIL)" --all-containers=true --prefix=true --previous; \
	else \
	  KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) logs -l "$(K8S_LOG_SELECTOR)" --tail="$(K8S_LOG_TAIL)" --all-containers=true --prefix=true; \
	fi

k8s-smoke: ## Smoke-test api and ui through temporary port-forwards
	@set -eu ; \
	smoke() { \
	  name="$$1"; local_port="$$2"; remote_port="$$3"; path="$$4"; log="$$(mktemp)"; \
	  KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) port-forward "svc/$$name" "$$local_port:$$remote_port" >"$$log" 2>&1 & pid="$$!"; \
	  ok=0; \
	  for _ in $$(seq 1 30); do \
	    if curl -fsS "http://127.0.0.1:$$local_port$$path" >/dev/null 2>&1; then ok=1; break; fi; \
	    sleep 1; \
	  done; \
	  kill "$$pid" >/dev/null 2>&1 || true; \
	  wait "$$pid" >/dev/null 2>&1 || true; \
	  if [ "$$ok" != "1" ]; then echo "ERROR: $$name smoke failed"; cat "$$log"; rm -f "$$log"; exit 1; fi; \
	  rm -f "$$log"; echo "OK: $$name $$path"; \
	}; \
	smoke api "$(K8S_API_SMOKE_PORT)" 8787 /api/v1/health; \
	smoke ui "$(K8S_UI_SMOKE_PORT)" 5173 /

k8s-api-netcheck: ## Check TCP connectivity from the k8s api pod (K8S_NETCHECK_HOST=..., K8S_NETCHECK_PORT=...)
	@KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) exec deploy/api -- env \
	  K8S_NETCHECK_HOST="$(K8S_NETCHECK_HOST)" \
	  K8S_NETCHECK_PORT="$(K8S_NETCHECK_PORT)" \
	  K8S_NETCHECK_TIMEOUT="$(K8S_NETCHECK_TIMEOUT)" \
	  node -e 'const net = require("node:net"); const host = process.env.K8S_NETCHECK_HOST; const port = Number(process.env.K8S_NETCHECK_PORT); const timeout = Number(process.env.K8S_NETCHECK_TIMEOUT); const started = Date.now(); const socket = net.createConnection({ host, port }); let finished = false; function finish(code, msg) { if (finished) return; finished = true; console.log(msg + " elapsed_ms=" + (Date.now() - started)); socket.destroy(); process.exit(code); } socket.setTimeout(timeout); socket.once("connect", () => finish(0, "OK: " + host + ":" + port + " reachable")); socket.once("timeout", () => finish(2, "ERROR: " + host + ":" + port + " timed out after " + timeout + "ms")); socket.once("error", (err) => finish(1, "ERROR: " + host + ":" + port + " " + (err.code || err.message)));'

k8s-email-smoke: ## Send a live email verification smoke via the k8s api (K8S_EMAIL_SMOKE_TO=...)
	@test -n "$(K8S_EMAIL_SMOKE_TO)" || { echo "ERROR: set K8S_EMAIL_SMOKE_TO=<recipient email>" >&2; exit 1; }
	@set -eu ; \
	log="$$(mktemp)" ; body="$$(mktemp)" ; pid="" ; \
	cleanup() { \
	  if [ -n "$$pid" ]; then kill "$$pid" >/dev/null 2>&1 || true; wait "$$pid" >/dev/null 2>&1 || true; fi; \
	  rm -f "$$log" "$$body"; \
	} ; \
	trap cleanup EXIT ; \
	KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) port-forward svc/api "$(K8S_API_SMOKE_PORT):8787" >"$$log" 2>&1 & pid="$$!" ; \
	ok=0 ; \
	for _ in $$(seq 1 30); do \
	  if curl -fsS "http://127.0.0.1:$(K8S_API_SMOKE_PORT)/api/v1/health" >/dev/null 2>&1; then ok=1; break; fi; \
	  sleep 1; \
	done ; \
	if [ "$$ok" != "1" ]; then echo "ERROR: api port-forward failed"; cat "$$log"; exit 1; fi ; \
	status="$$(curl -sS -o "$$body" -w "%{http_code}" \
	  --max-time "$(K8S_EMAIL_SMOKE_TIMEOUT)" \
	  -H "Content-Type: application/json" \
	  --data '{"email":"$(K8S_EMAIL_SMOKE_TO)"}' \
	  "http://127.0.0.1:$(K8S_API_SMOKE_PORT)/api/v1/auth/email/verify-request")" ; \
	if [ "$$status" != "200" ]; then echo "ERROR: email smoke returned HTTP $$status"; cat "$$body"; exit 1; fi ; \
	if ! grep -q '"success"[[:space:]]*:[[:space:]]*true' "$$body"; then echo "ERROR: email smoke response did not confirm success"; cat "$$body"; exit 1; fi ; \
	echo "OK: verification email request accepted for $(K8S_EMAIL_SMOKE_TO)"

gh-k8s-secret: ## Create/update GH Actions secret KUBECONFIG_B64 from $(KUBECONFIG)
	@test -s "$(KUBECONFIG)" || (echo "ERROR: missing or empty KUBECONFIG=$(KUBECONFIG)" >&2; exit 1)
	@command -v gh >/dev/null 2>&1 || (echo "ERROR: gh CLI is required" >&2; exit 1)
	@echo "Setting GitHub Actions secret $(GH_K8S_SECRET_NAME) in $(GH_REPO) from $(KUBECONFIG)."
	@echo "The secret value is piped to gh and is not printed or written to disk."
	@base64 "$(KUBECONFIG)" | tr -d '\n' | gh secret set "$(GH_K8S_SECRET_NAME)" --repo "$(GH_REPO)"
	@echo "GitHub Actions secret $(GH_K8S_SECRET_NAME) updated in $(GH_REPO)."

gh-k8s-secret-check: ## Check that the GH Actions kubeconfig secret exists
	@command -v gh >/dev/null 2>&1 || (echo "ERROR: gh CLI is required" >&2; exit 1)
	@gh secret list --repo "$(GH_REPO)" | awk -v name="$(GH_K8S_SECRET_NAME)" 'BEGIN { found=0 } $$1 == name { found=1 } END { if (found) { printf "OK: GitHub Actions secret %s exists\n", name; exit 0 } printf "ERROR: GitHub Actions secret %s not found\n", name; exit 1 }'

gh-k8s-rerun-deploy: ## Rerun failed jobs of a GitHub Actions deploy run (GH_DEPLOY_RUN_ID=...)
	@test -n "$(GH_DEPLOY_RUN_ID)" || (echo "ERROR: GH_DEPLOY_RUN_ID is required, for example GH_DEPLOY_RUN_ID=26159456218" >&2; exit 1)
	gh run rerun "$(GH_DEPLOY_RUN_ID)" --failed --repo "$(GH_REPO)"

gh-k8s-watch: ## Watch a GitHub Actions deploy run until completion (GH_DEPLOY_RUN_ID=...)
	@test -n "$(GH_DEPLOY_RUN_ID)" || (echo "ERROR: GH_DEPLOY_RUN_ID is required, for example GH_DEPLOY_RUN_ID=26159456218" >&2; exit 1)
	gh run watch "$(GH_DEPLOY_RUN_ID)" --repo "$(GH_REPO)" --interval 30 --exit-status

# --- Secrets provisioning: cluster-only (mode 2) -----------------------------
# Secrets are provisioned DIRECTLY into the live cluster from a gitignored env
# file via `make k8s-bundle-secret K8S_ENV_FILE=.env.prod` (target above). No
# SealedSecrets, no controller, no secret material in git. The prod .env holds
# 24 keys (api 17 + OAUTH_SIGNING_KEK, postgres POSTGRES_PASSWORD, pgbackup S3_*)
# and lives ONLY on the operator machine + the live cluster.

# --- Postgres backup (BR37c-EX1, append-only; operator-side, live cluster) ----
# Manual trigger / restore helpers around deploy/k8s/base/70-pgbackup-cronjob.yaml.
# Backup S3 creds + bucket come from the sentropic-pgbackup SealedSecret; the
# CronJob dumps with pg_dump (initContainer) and uploads via aws-cli. These
# targets never hardcode a secret value.
.PHONY: k8s-pgbackup-now k8s-pgbackup-restore

k8s-pgbackup-now: ## Trigger an immediate Postgres backup Job from the CronJob and wait for completion
	@set -eu ; job="pgbackup-manual-$$(date -u +%Y%m%d%H%M%S)" ; \
	echo "==> Creating Job $$job from cronjob/pgbackup" ; \
	KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) create job "$$job" --from=cronjob/pgbackup ; \
	KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) wait --for=condition=complete --timeout=180s "job/$$job" || { \
	  echo "Job did not complete; recent logs:" >&2 ; \
	  KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) logs "job/$$job" --all-containers --tail=40 >&2 || true ; exit 1 ; } ; \
	KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) logs "job/$$job" -c upload --tail=10 ; \
	echo "==> Backup Job $$job complete."

k8s-pgbackup-restore: ## Restore a dump from S3 into a scratch DB for verification (PG_BACKUP_KEY=pg/<ts>.sql.gz)
	@test -n "$(PG_BACKUP_KEY)" || { echo "ERROR: set PG_BACKUP_KEY=pg/<timestamp>.sql.gz (see: make k8s-pgbackup-list)" >&2; exit 1; }
	@set -eu ; pod="pgbackup-restore-$$(date -u +%Y%m%d%H%M%S)" ; \
	echo "==> Restoring $(PG_BACKUP_KEY) into scratch DB restore_check on postgres (non-destructive to app DB)" ; \
	KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) run "$$pod" --rm -i --restart=Never --image=postgres:17-alpine \
	  --labels="app.kubernetes.io/name=sentropic,app.kubernetes.io/component=pgbackup" \
	  --env PGHOST=postgres --env PGPORT=5432 --env PGUSER=app --env PGDATABASE=app \
	  --env PGPASSWORD="$$(KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) get secret sentropic-postgres -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)" \
	  --env AWS_ACCESS_KEY_ID="$$(KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) get secret sentropic-pgbackup -o jsonpath='{.data.S3_ACCESS_KEY}' | base64 -d)" \
	  --env AWS_SECRET_ACCESS_KEY="$$(KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) get secret sentropic-pgbackup -o jsonpath='{.data.S3_SECRET_KEY}' | base64 -d)" \
	  --env S3_BUCKET="$$(KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) get secret sentropic-pgbackup -o jsonpath='{.data.S3_BUCKET}' | base64 -d)" \
	  --env S3_ENDPOINT="$$(KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) get secret sentropic-pgbackup -o jsonpath='{.data.S3_ENDPOINT}' | base64 -d)" \
	  --env S3_REGION="$$(KUBECONFIG=$(KUBECONFIG) kubectl -n $(K8S_NAMESPACE) get secret sentropic-pgbackup -o jsonpath='{.data.S3_REGION}' | base64 -d)" \
	  --command -- sh -c 'set -e; apk add --no-cache aws-cli >/dev/null 2>&1 || true; \
	    aws s3 cp "s3://$$S3_BUCKET/$(PG_BACKUP_KEY)" /tmp/d.sql.gz --endpoint-url "$$S3_ENDPOINT" --region "$$S3_REGION"; \
	    psql -c "DROP DATABASE IF EXISTS restore_check;" -c "CREATE DATABASE restore_check;"; \
	    gunzip -c /tmp/d.sql.gz | psql -d restore_check; \
	    psql -d restore_check -c "SELECT count(*) AS organizations FROM organizations;" || true; \
	    psql -c "DROP DATABASE restore_check;"; echo "restore verification OK"'

# --- Public DNS/TLS smoke (BR37c-EX1, append-only; operator-side) --------------
# Verify the public host reaches the cluster through the shared Traefik LB with a
# browser-trusted certificate. No -k: a self-signed/staging cert makes curl fail,
# which is what we want (the gate is a trusted letsencrypt-prod cert). Also checks
# /api/v1/health, proxied by the UI nginx to api:8787.
K8S_HOST ?= sentropic.sent-tech.ca
.PHONY: k8s-dns-smoke

k8s-dns-smoke: ## Smoke-test the public host: HTTPS 200 + trusted cert on / and /api/v1/health (K8S_HOST=...)
	@set -eu ; host="$(K8S_HOST)" ; \
	echo "==> Resolving $$host" ; getent hosts "$$host" || { echo "ERROR: $$host does not resolve" >&2; exit 1; } ; \
	for path in / /api/v1/health ; do \
	  status="$$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://$$host$$path")" ; \
	  if [ "$$status" != "200" ]; then echo "ERROR: https://$$host$$path returned HTTP $$status (or untrusted cert)" >&2; exit 1; fi ; \
	  echo "OK: https://$$host$$path -> 200 (trusted cert)" ; \
	done ; \
	echo "==> Public DNS/TLS smoke passed for $$host"

# -----------------------------------------------------------------------------
# OAuth2 / OIDC IdP key management (BR-39c, BR39c-EX4)
# Requires a running API container. Always pass API_PORT, UI_PORT, MAILDEV_UI_PORT, ENV.
# -----------------------------------------------------------------------------
.PHONY: oauth-init-keys
oauth-init-keys: ## Bootstrap the first active Ed25519 signing key (idempotent; exits if key already exists)
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec api sh -lc "npm run oauth:init-keys"

.PHONY: oauth-rotate-keys
oauth-rotate-keys: ## Rotate the active Ed25519 signing key; old key stays in JWKS for ≥65 min
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec api sh -lc "npm run oauth:rotate-keys"

.PHONY: oauth-rotate-service-client
oauth-rotate-service-client: ## Rotate a service client secret (single-secret cutover). Usage: make oauth-rotate-service-client CLIENT_ID=<id> ENV=<env>
	@test -n "$(CLIENT_ID)" || { echo "ERROR: CLIENT_ID is required: make oauth-rotate-service-client CLIENT_ID=<id> ENV=<env>"; exit 1; }
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml exec -e CLIENT_ID="$(CLIENT_ID)" api sh -lc "npm run oauth:rotate-service-client"
