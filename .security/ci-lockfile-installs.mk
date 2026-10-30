.PHONY: test-ci-lockfile-installs
CI_LOCKFILE_NODE_IMAGE := node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
test-ci-lockfile-installs: test-ci-lockfile-context ## Refuse unlocked CI dependency resolution and verify frozen consumers
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace:ro" -w /workspace $(CI_LOCKFILE_NODE_IMAGE) node --test scripts/ci/ci-lockfile-installs.test.mjs

.PHONY: test-ci-lockfile-context
test-ci-lockfile-context: ## Prove the API lock installer inputs survive Docker context filtering
	@printf 'FROM scratch\nCOPY scripts/ci/locked-tools.mjs scripts/ci/tool-locks.json /inputs/\n' | docker buildx build --quiet --file - --output type=cacheonly .

.PHONY: lock-ci-tools
lock-ci-tools: ## Deliberately update isolated tool locks for review; forbidden in CI
	@test -z "$${CI:-}" || { echo 'Lock updates are forbidden in CI'; exit 1; }
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e CI -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace $(CI_LOCKFILE_NODE_IMAGE) node scripts/ci/update-tool-locks.mjs --write-locks
