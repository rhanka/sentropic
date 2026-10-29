# No build, network access or service startup is needed by the generator/checker.
E11_DIR := tools/engram-e11
E11_INPUT ?= $(CURDIR)/tmp/engram-e11-current
E11_REPOSITORY ?= $(shell git rev-parse --path-format=absolute --git-common-dir | sed 's@/\.git$$@@')
E11_RETAIN ?= $(E11_REPOSITORY)/.tmp/engram-e2-host-tuple/e11b-current
E11_IMAGE := node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
E11_REVIEW_HEAD := 1deb70a5f530aca72ea9200c219e6865ca24f9c7
E11_REVIEW_WT := $(CURDIR)/tmp/engram-e11-reviewed
.PHONY: memory-e11-reviewed-prepare
# Preserve the approved dev.7 proof independently of the stable release campaign.
memory-e11-reviewed-prepare:
	@test -n "$(filter test-e2-int test-mem-release,$(ENV))"
	@test ! -e "$(E11_REVIEW_WT)"
	@git worktree add --detach "$(E11_REVIEW_WT)" $(E11_REVIEW_HEAD)
	@flock "$(E2_LOCK)" $(MAKE) -C "$(E11_REVIEW_WT)" engram-e2-lane E2_LANE=stage-b ENV=$(ENV)

E11_RUN = docker run --rm $(LOCKED_INSTALL_MOUNTS) --network none -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace:ro" -v "$(E11_INPUT):/evidence" -w /workspace $(E11_IMAGE)
.PHONY: memory-e11-prepare memory-e11-generate memory-e11-check memory-e11-test
memory-e11-prepare:
	@test -n "$(filter test-mem-e11 test-mem-e11b test-e2-int,$(ENV))"
	@bash $(E11_DIR)/prepare.sh "$(E11_REPOSITORY)" "$(E11_INPUT)"

memory-e11-generate:
	@test -n "$(filter test-mem-e11 test-mem-e11b test-e2-int,$(ENV))"
	@$(E11_RUN) node $(E11_DIR)/tuple.mjs generate /evidence /evidence/e2-host-tuple.v1.json

memory-e11-check:
	@test -n "$(filter test-mem-e11 test-mem-e11b test-e2-int,$(ENV))"
	@$(E11_RUN) node $(E11_DIR)/tuple.mjs check /evidence /evidence/e2-host-tuple.v1.json $(E11_CHECK_FLAGS)

memory-e11-test:
	@test -n "$(filter test-mem-e11 test-mem-e11b test-e2-int,$(ENV))"
	@$(E11_RUN) node --test $(E11_DIR)/tuple.test.mjs

.PHONY: memory-e11-retain
memory-e11-retain:
	@test -n "$(filter test-mem-e11 test-mem-e11b test-e2-int,$(ENV))"
	@test -f "$(E11_INPUT)/e2-host-tuple.v1.json"
	@mkdir -p "$(E11_RETAIN)"
	@cp -a "$(E11_INPUT)/." "$(E11_RETAIN)/"
	@mkdir -p "$(E11_REPOSITORY)/.tmp/engram-e2-host-tuple/e10-artifacts"
	@cp "$(E11_INPUT)/mesh.tgz" "$(E11_REPOSITORY)/.tmp/engram-e2-host-tuple/e10-artifacts/sentropic-cluster-mesh-0.24.0-dev.7.tgz"
	@cd "$(E11_REPOSITORY)/.tmp/engram-e2-host-tuple/e10-artifacts" && \
	  sha256sum sentropic-cluster-mesh-0.24.0-dev.7.tgz > sentropic-cluster-mesh-0.24.0-dev.7.tgz.sha256

.PHONY: memory-e11-snapshot
memory-e11-snapshot:
	@test -n "$(filter test-mem-e11 test-mem-e11b test-e2-int,$(ENV))"
	@cp $(E11_DIR)/*.mjs $(E11_DIR)/*.sh $(E11_DIR)/e11.mk "$(E11_INPUT)/"

.PHONY: memory-e11-ci-input
memory-e11-ci-input:
	@test -n "$(filter test-mem-e11 test-mem-e11b test-e2-int,$(ENV))"
	@gh api 'repos/rhanka/sentropic/actions/runs?head_sha=cfd45de4d54651626e97113494b9d7bd108998c8&event=pull_request&per_page=100' > "$(E11_INPUT)/e10-ci.json"

# First freeze a new E2 consumer lock; qualification thereafter only uses npm ci.
.PHONY: memory-e11-stage memory-e11-lock memory-e11-installed
memory-e11-stage:
	@test -n "$(filter test-mem-e11 test-mem-e11b test-e2-int,$(ENV))"
	@$(E11_RUN) node tools/engram-e11/stage.mjs /evidence

memory-e11-lock: memory-e11-stage
	@test -n "$(filter test-mem-e11 test-mem-e11b test-e2-int,$(ENV))"
	@docker run --rm $(LOCKED_INSTALL_MOUNTS) -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(E11_INPUT):/evidence" -w /evidence/consumer $(E11_IMAGE) \
	  sh -ec 'test ! -e package-lock.json; node /workspace/scripts/ci/locked-consumer.mjs --package-lock-only --ignore-scripts --no-audit --no-fund'

memory-e11-installed:
	@test -n "$(filter test-mem-e11 test-mem-e11b test-e2-int,$(ENV))"
	@bash tools/engram-e11/installed.sh "$(E11_INPUT)" "$(ARTIFACTS_COMPOSE)" "$(ENV)"
	@$(MAKE) -f Makefile -f $(E11_DIR)/e11.mk memory-e11-finalize ENV=$(ENV)

.PHONY: memory-e11-finalize
memory-e11-finalize:
	@test -n "$(filter test-mem-e11 test-mem-e11b test-e2-int,$(ENV))"
	@$(E11_RUN) node tools/engram-e11/finalize.mjs /evidence
