# B3 packed qualification for @sentropic/cluster-mesh (package-local, Docker only, npm only).
# Run from the repository root:
#   make -f packages/cluster-mesh/packaging.mk test-lazy-package API_PORT=<p> UI_PORT=<p> MAILDEV_UI_PORT=<p> ENV=<env>
# Builds the candidate, packs it, installs it with public peer tarballs from the
# registry into container scratch space (outside workspace resolution), then runs
# tests/packaging/** against those installed trees: bare, frozen selected tuple
# (`npm ci`), session mode, latest-in-range, global consumer + separately installed
# runtime, and gateway 0.17 skew. No host npm/Node.
# `refresh-lazy-package-lock` regenerates tests/packaging/fixtures/selected/package-lock.json.
LLM_MESH_NODE_IMAGE ?= node:24-bookworm-slim
ENV ?= test
LAZY_PACKAGE_RUN = docker run --rm --init -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
	-v "$(CURDIR):/workspace" -w /workspace/packages/cluster-mesh $(LLM_MESH_NODE_IMAGE)

.PHONY: test-lazy-package refresh-lazy-package-lock
test-lazy-package:
	@$(MAKE) --no-print-directory -f Makefile build-cluster-mesh ENV=$(ENV)
	@$(LAZY_PACKAGE_RUN) sh -lc 'set -eu; work=/tmp/lazy-package; sh tests/packaging/prepare.sh "$$work"; \
		CLUSTER_MESH_PACKAGING_DIR="$$work" NODE_PATH="$$work/tools/node_modules" \
		"$$work/tools/node_modules/.bin/vitest" run tests/packaging --environment node'

refresh-lazy-package-lock:
	@$(MAKE) --no-print-directory -f Makefile build-cluster-mesh ENV=$(ENV)
	@$(LAZY_PACKAGE_RUN) sh -lc 'set -eu; REFRESH_LOCK=1 sh tests/packaging/prepare.sh /tmp/lazy-package'
