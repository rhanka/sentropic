.PHONY: test-ci-lockfile-installs
test-ci-lockfile-installs: ## Refuse unlocked CI dependency resolution and verify frozen consumers
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace:ro" -w /workspace $(LLM_MESH_NODE_IMAGE) node --test scripts/ci/ci-lockfile-installs.test.mjs

.PHONY: lock-ci-tools
lock-ci-tools: ## Deliberately update isolated tool locks for review; forbidden in CI
	@test -z "$${CI:-}" || { echo 'Lock updates are forbidden in CI'; exit 1; }
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e CI -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace $(LLM_MESH_NODE_IMAGE) node scripts/ci/update-tool-locks.mjs --write-locks
