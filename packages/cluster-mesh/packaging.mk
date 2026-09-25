# B3 packed qualification for @sentropic/cluster-mesh (package-local, Docker only).
# Run from the repository root:
#   make -f packages/cluster-mesh/packaging.mk test-lazy-package API_PORT=<p> UI_PORT=<p> MAILDEV_UI_PORT=<p> ENV=<env>
# Builds the candidate, packs it, installs it with public peer tarballs from the
# registry into container scratch space (outside workspace resolution), then runs
# tests/packaging/** against those installed trees. No host npm/Node.
LLM_MESH_NODE_IMAGE ?= node:24-bookworm-slim
ENV ?= test

.PHONY: test-lazy-package
test-lazy-package:
	@$(MAKE) --no-print-directory -f Makefile build-cluster-mesh ENV=$(ENV)
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
		-v "$(CURDIR):/workspace" -w /workspace/packages/cluster-mesh $(LLM_MESH_NODE_IMAGE) \
		sh -lc 'set -eu; work=/tmp/lazy-package; sh tests/packaging/prepare.sh "$$work"; \
		CLUSTER_MESH_PACKAGING_DIR="$$work" NODE_PATH="$$work/tools/node_modules" \
		"$$work/tools/node_modules/.bin/vitest" run tests/packaging --environment node'
