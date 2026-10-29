.PHONY: test-ci-lockfile-installs
test-ci-lockfile-installs: ## Refuse unlocked CI dependency resolution and verify frozen consumers
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace:ro" -w /workspace $(LLM_MESH_NODE_IMAGE) node --test scripts/ci/ci-lockfile-installs.test.mjs
