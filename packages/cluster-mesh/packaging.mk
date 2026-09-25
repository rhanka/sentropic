# B3 packed qualification for @sentropic/cluster-mesh (package-local, Docker only, npm only).
# Run from the repository root:
#   make -f packages/cluster-mesh/packaging.mk test-lazy-package [SIBLING_ARCHIVES_FILE=<receipts>] ENV=<env>
# Builds the candidate, packs it, installs it with public peer tarballs from the
# registry into container scratch space (outside workspace resolution), then runs
# tests/packaging/** against those installed trees: bare, frozen selected tuple
# (`npm ci`), session mode, latest-in-range, global consumer + separately installed
# runtime, and the old-tuple (llm-mesh 0.21.2 / llm-gateway 0.18.0) refusal. No host npm/Node.
# Release train: SIBLING_ARCHIVES_FILE=tmp/ci-manifest-guard/siblings/cluster-mesh/receipts.json (written by
# `make pack-candidate-siblings`, exactly this path) replaces the registry with the verified same-PR sibling
# archive for exactly the name@version it carries (provisional `selected` install, lock integrity asserted).
# `refresh-lazy-package-lock` regenerates tests/packaging/fixtures/selected/package-lock.json.
# `check-train-lock-integrity` compares the registry dist.integrity of published train packages with that lock.
LLM_MESH_NODE_IMAGE ?= node:24-bookworm-slim
ENV ?= test
SIBLING_ARCHIVES_FILE ?=
CLUSTER_MESH_SIBLING_RECEIPTS := tmp/ci-manifest-guard/siblings/cluster-mesh/receipts.json
LAZY_SIBLING_ENV = $(if $(SIBLING_ARCHIVES_FILE),$(if $(and $(filter 1,$(words $(SIBLING_ARCHIVES_FILE))),$(filter $(CLUSTER_MESH_SIBLING_RECEIPTS),$(SIBLING_ARCHIVES_FILE))),-e CLUSTER_MESH_SIBLING_RECEIPTS=/workspace/$(CLUSTER_MESH_SIBLING_RECEIPTS),$(error SIBLING_ARCHIVES_FILE must be exactly $(CLUSTER_MESH_SIBLING_RECEIPTS))))
LAZY_SIBLING_CHECK = $(if $(SIBLING_ARCHIVES_FILE),@test -f "$(CLUSTER_MESH_SIBLING_RECEIPTS)" || { echo "ERROR: $(CLUSTER_MESH_SIBLING_RECEIPTS) is not a file"; exit 1; })
LAZY_PACKAGE_RUN = docker run --rm --init -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache $(LAZY_SIBLING_ENV) \
	-v "$(CURDIR):/workspace" -w /workspace/packages/cluster-mesh $(LLM_MESH_NODE_IMAGE)

.PHONY: test-lazy-package refresh-lazy-package-lock check-train-lock-integrity
test-lazy-package:
	$(LAZY_SIBLING_CHECK)
	@$(MAKE) --no-print-directory -f Makefile build-cluster-mesh ENV=$(ENV)
	@$(LAZY_PACKAGE_RUN) sh -lc 'set -eu; work=/tmp/lazy-package; sh tests/packaging/prepare.sh "$$work"; \
		CLUSTER_MESH_PACKAGING_DIR="$$work" NODE_PATH="$$work/tools/node_modules" \
		"$$work/tools/node_modules/.bin/vitest" run tests/packaging --environment node'

refresh-lazy-package-lock:
	$(LAZY_SIBLING_CHECK)
	@$(MAKE) --no-print-directory -f Makefile build-cluster-mesh ENV=$(ENV)
	@$(LAZY_PACKAGE_RUN) sh -lc 'set -eu; REFRESH_LOCK=1 sh tests/packaging/prepare.sh /tmp/lazy-package'

check-train-lock-integrity:
	@$(LAZY_PACKAGE_RUN) node tests/packaging/check-lock-integrity.mjs registry tests/packaging/fixtures/selected/package-lock.json
