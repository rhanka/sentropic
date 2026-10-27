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
# `check-train-lock-integrity` compares the registry dist.tarball/dist.integrity of published train packages with that lock;
# REQUIRE_PUBLISHED="<name>..." (packages whose publish job succeeded in this run) must appear on the registry (retried).
LLM_MESH_NODE_IMAGE ?= node:24-bookworm-slim
ENV ?= test
SIBLING_ARCHIVES_FILE ?=
REQUIRE_PUBLISHED ?=
CLUSTER_MESH_SIBLING_RECEIPTS := tmp/ci-manifest-guard/siblings/cluster-mesh/receipts.json
# Receipts must be packed from this commit (same default as the root QUALIFY_HEAD_SHA of qualify-published-install).
CLUSTER_MESH_HEAD_SHA ?= $(shell git rev-parse HEAD 2>/dev/null)
LAZY_SIBLING_ENV = $(if $(SIBLING_ARCHIVES_FILE),$(if $(and $(filter 1,$(words $(SIBLING_ARCHIVES_FILE))),$(filter $(CLUSTER_MESH_SIBLING_RECEIPTS),$(SIBLING_ARCHIVES_FILE))),-e CLUSTER_MESH_SIBLING_RECEIPTS=/workspace/$(CLUSTER_MESH_SIBLING_RECEIPTS) -e CLUSTER_MESH_HEAD_SHA="$(CLUSTER_MESH_HEAD_SHA)",$(error SIBLING_ARCHIVES_FILE must be exactly $(CLUSTER_MESH_SIBLING_RECEIPTS))))
LAZY_SIBLING_CHECK = $(if $(SIBLING_ARCHIVES_FILE),@test -f "$(CLUSTER_MESH_SIBLING_RECEIPTS)" || { echo "ERROR: $(CLUSTER_MESH_SIBLING_RECEIPTS) is not a file"; exit 1; })
LAZY_PACKAGE_RUN = docker run --rm --init -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache $(LAZY_SIBLING_ENV) \
	-v "$(CURDIR):/workspace" -w /workspace/packages/cluster-mesh $(LLM_MESH_NODE_IMAGE)
ifneq ($(filter $(ENV),test-861-int test-llm-judge),)
LAZY_PACKAGE_RUN = docker compose -p $(ENV) -f docker-compose.immo-861.yml run --rm --no-deps \
	-u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache $(LAZY_SIBLING_ENV) \
	-v "$(CURDIR):/workspace" -w /workspace/packages/cluster-mesh qualification
endif

.PHONY: test-lazy-package refresh-lazy-package-lock check-train-lock-integrity
# UP-T-2: the same packed-consumer harness, limited to activation and a disposable DB.
.PHONY: test-lazy-package-activation
test-lazy-package-activation:
	@case "$(ENV)" in test-*) ;; *) echo 'A dedicated test ENV is required'; exit 1 ;; esac
	@$(MAKE) --no-print-directory -f Makefile build-artifacts ENV=$(ENV)
	@docker compose -p $(ENV) -f docker-compose.immo-861.yml up -d --wait postgres
	@printf '%s\n' "SELECT 'CREATE DATABASE test_artifacts_upt2' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='test_artifacts_upt2')" '\gexec' | \
		docker compose -p $(ENV) -f docker-compose.immo-861.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U app -d app
	@docker compose -p $(ENV) -f docker-compose.immo-861.yml run --rm --no-deps \
		-u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
		-e DATABASE_URL=postgres://app:app@postgres:5432/test_artifacts_upt2 \
		-e ACTIVATION_DISPOSABLE=1 -e ACTIVATION_CONFORMANCE_REQUIRED=1 \
		-w /workspace/packages/cluster-mesh qualification sh -lc 'set -eu; work=/tmp/lazy-activation; \
		CLUSTER_MESH_PREPARE_ONLY=activation sh tests/packaging/prepare.sh "$$work"; \
		cp vitest.config.ts "$$work/tools/vitest.config.ts"; \
		CLUSTER_MESH_PACKAGING_DIR="$$work" "$$work/tools/node_modules/.bin/vitest" \
		run tests/packaging/activation-vectors.spec.ts --config "$$work/tools/vitest.config.ts" --environment node --maxWorkers=1 \
		--reporter=default --reporter=json --outputFile.json="$$work/activation-results.json"; \
		node -e '\''const fs=require("node:fs"), assert=require("node:assert/strict"); const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); assert.equal(r.numPassedTests,9); assert.equal(r.numPendingTests,0);'\'' "$$work/activation-results.json"'

# Activation vectors require the dedicated mandatory PostgreSQL target used by validate-artifacts.
test-lazy-package:
	$(LAZY_SIBLING_CHECK)
	@$(MAKE) --no-print-directory -f Makefile build-cluster-mesh ENV=$(ENV)
	@$(MAKE) --no-print-directory -f Makefile $(if $(filter test-861-int,$(ENV)),immo-861-build-mcp-platform,build-mcp-platform) ENV=$(ENV)
	@$(MAKE) --no-print-directory -f Makefile build-artifacts ENV=$(ENV)
	@$(MAKE) --no-print-directory -f Makefile build-llm-mesh ENV=$(ENV)
	@$(MAKE) --no-print-directory -f Makefile build-llm-gateway ENV=$(ENV)
	@$(MAKE) --no-print-directory -f Makefile build-comments ENV=$(ENV)
	@$(LAZY_PACKAGE_RUN) sh -lc 'set -eu; work=/tmp/lazy-package; sh tests/packaging/prepare.sh "$$work"; \
		cp vitest.config.ts "$$work/tools/vitest.config.ts"; \
		CLUSTER_MESH_PACKAGING_DIR="$$work" NODE_PATH="$$work/tools/node_modules" \
		"$$work/tools/node_modules/.bin/vitest" run tests/packaging --exclude tests/packaging/activation-vectors.spec.ts --config "$$work/tools/vitest.config.ts" --environment node --maxWorkers=1'

refresh-lazy-package-lock:
	$(LAZY_SIBLING_CHECK)
	@$(MAKE) --no-print-directory -f Makefile build-cluster-mesh ENV=$(ENV)
	@$(LAZY_PACKAGE_RUN) sh -lc 'set -eu; REFRESH_LOCK=1 sh tests/packaging/prepare.sh /tmp/lazy-package'

check-train-lock-integrity:
	@$(LAZY_PACKAGE_RUN) node tests/packaging/check-lock-integrity.mjs registry tests/packaging/fixtures/selected/package-lock.json $(REQUIRE_PUBLISHED)
