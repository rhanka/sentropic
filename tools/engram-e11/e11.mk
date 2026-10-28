# No build, network access or service startup is needed by the generator/checker.
E11_DIR := tools/engram-e11
E11_INPUT ?= $(CURDIR)/tmp/engram-e11-current
E11_REPOSITORY ?= $(shell git rev-parse --path-format=absolute --git-common-dir | sed 's@/\.git$$@@')
E11_RETAIN ?= $(E11_REPOSITORY)/.tmp/engram-e2-host-tuple/e11-current
E11_IMAGE := node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
E11_RUN = docker run --rm --network none -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace:ro" -v "$(E11_INPUT):/evidence" -w /workspace $(E11_IMAGE)
.PHONY: memory-e11-prepare memory-e11-generate memory-e11-check memory-e11-test
memory-e11-prepare:
	@test "$(ENV)" = test-mem-e11
	@bash $(E11_DIR)/prepare.sh "$(E11_REPOSITORY)" "$(E11_INPUT)"

memory-e11-generate:
	@test "$(ENV)" = test-mem-e11
	@$(E11_RUN) node $(E11_DIR)/tuple.mjs generate /evidence /evidence/e2-host-tuple.v1.json

memory-e11-check:
	@test "$(ENV)" = test-mem-e11
	@$(E11_RUN) node $(E11_DIR)/tuple.mjs check /evidence /evidence/e2-host-tuple.v1.json $(E11_CHECK_FLAGS)

memory-e11-test:
	@test "$(ENV)" = test-mem-e11
	@$(E11_RUN) node --test $(E11_DIR)/tuple.test.mjs

.PHONY: memory-e11-retain
memory-e11-retain:
	@test "$(ENV)" = test-mem-e11
	@test -f "$(E11_INPUT)/e2-host-tuple.v1.json"
	@mkdir -p "$(E11_RETAIN)"
	@cp -a "$(E11_INPUT)/." "$(E11_RETAIN)/"

.PHONY: memory-e11-snapshot
memory-e11-snapshot:
	@test "$(ENV)" = test-mem-e11
	@cp $(E11_DIR)/*.mjs $(E11_DIR)/*.sh $(E11_DIR)/e11.mk "$(E11_INPUT)/"

# First freeze a new E2 consumer lock; qualification thereafter only uses npm ci.
.PHONY: memory-e11-lock memory-e11-installed
memory-e11-lock:
	@test "$(ENV)" = test-mem-e11
	@$(E11_RUN) node tools/engram-e11/stage.mjs /evidence
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(E11_INPUT):/evidence" -w /evidence/consumer $(E11_IMAGE) \
	  sh -ec 'test ! -e package-lock.json; npm install --package-lock-only --ignore-scripts --no-audit --no-fund'

memory-e11-installed:
	@test "$(ENV)" = test-mem-e11
	@bash tools/engram-e11/installed.sh "$(E11_INPUT)" "$(ARTIFACTS_COMPOSE)"
	@$(MAKE) -f Makefile -f $(E11_DIR)/e11.mk memory-e11-finalize ENV=$(ENV)

.PHONY: memory-e11-finalize
memory-e11-finalize:
	@test "$(ENV)" = test-mem-e11
	@$(E11_RUN) node tools/engram-e11/finalize.mjs /evidence
