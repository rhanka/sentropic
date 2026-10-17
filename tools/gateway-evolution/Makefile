# BR120-EX7: opt-in gateway/registry tooling; root recipes remain authoritative.
ifneq ($(origin ENV),command line)
$(error ENV must come from the command line)
endif
ifeq ($(strip $(ENV)),)
$(error ENV must not be empty)
endif
include Makefile
GW_EVOL_DOTENV_PROJECT := $(shell test ! -f .env || sed -n '/^[[:space:]]*\(export[[:space:]]\+\)\?COMPOSE_PROJECT_NAME[[:space:]]*[:?+]*=/p' .env)
ifneq ($(GW_EVOL_DOTENV_PROJECT),)
$(error COMPOSE_PROJECT_NAME must not be set from .env)
endif
ifneq ($(COMPOSE_PROJECT_NAME),$(ENV))
$(error COMPOSE_PROJECT_NAME must equal ENV)
endif
GW_EVOL_IMAGE := node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
GW_EVOL_RUN = bash tools/gateway-evolution/runner.sh "$(ENV)" "$(GW_EVOL_IMAGE)"
GW_EVOL_ROW_pr1 := test-gw-durable-vibe-muse|9600|5800|1700|19600
GW_EVOL_ROW_pr2 := test-gw-claude-stack|9605|5805|1705|19605
GW_EVOL_ROW_pr3 := test-gw-cli-protocol-coverage|9610|5810|1710|19610
DELIVERY ?= $(GW_EVOL_DELIVERY)

.PHONY: gateway-harness-test gateway-host-packed-test gateway-consumer-gate gateway-release-check gateway-candidate-bundle gateway-client-fixtures gateway-client-e2e

define gw_manifest
@test -n "$(ARTIFACT_MANIFEST)" -a -f "$(ARTIFACT_MANIFEST)" || { echo 'ERROR: ARTIFACT_MANIFEST must name an existing file' >&2; exit 1; }
endef

define gw_ports
@test "$(origin API_PORT)|$(origin UI_PORT)|$(origin MAILDEV_UI_PORT)|$(origin GATEWAY_PORT)" = 'command line|command line|command line|command line' || { echo 'ERROR: explicit API_PORT UI_PORT MAILDEV_UI_PORT GATEWAY_PORT required' >&2; exit 1; }
endef

gateway-harness-test:
	$(gw_manifest)
	@test "$(MODE)" = pure -o "$(MODE)" = behavior || { echo 'ERROR: MODE must be pure or behavior' >&2; exit 1; }
	@$(GW_EVOL_RUN) node tools/gateway-evolution/run.mjs check-manifest --manifest "$(ARTIFACT_MANIFEST)" --expect-image-reference node:24-bookworm-slim --expect-image-digest 0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
	@if [ "$(MODE)" = pure ]; then \
	  $(GW_EVOL_RUN) node --test tools/gateway-evolution/tests/*.test.mjs; \
	else \
	  test "$(origin API_PORT)|$(origin UI_PORT)|$(origin MAILDEV_UI_PORT)|$(origin GATEWAY_PORT)" = 'command line|command line|command line|command line' || { echo 'ERROR: explicit API_PORT UI_PORT MAILDEV_UI_PORT GATEWAY_PORT required' >&2; exit 1; }; \
	  bash tools/gateway-evolution/tests/make-contract.test.sh "$(ENV)" && \
	  bash tools/gateway-evolution/tests/runner-cleanup.test.sh "$(ENV)" "$(GW_EVOL_IMAGE)"; \
	fi

gateway-host-packed-test:
	$(gw_manifest)
	@test -n "$(SCOPE)" || { echo 'ERROR: SCOPE is required' >&2; exit 1; }
	@$(GW_EVOL_RUN) node tools/gateway-evolution/run.mjs packed-gate --manifest "$(ARTIFACT_MANIFEST)" --scope "$(SCOPE)"

gateway-consumer-gate:
	$(gw_manifest)
	@test -n "$(CONSUMER_PROGRAM)" -a -n "$(H2A_CI_RUN_ID)" -a -n "$(H2A_CI_RUN_ATTEMPT)" -a -n "$(H2A_HEAD_SHA)" -a -n "$(H2A_BASE_SHA)" -a -n "$(H2A_MERGE_SHA)" || { echo 'ERROR: expected program/run/attempt/head/base/merge are required' >&2; exit 1; }
	@$(GW_EVOL_RUN) node tools/gateway-evolution/run.mjs consumer-gate --program "$(CONSUMER_PROGRAM)" --manifest "$(ARTIFACT_MANIFEST)" --run-id "$(H2A_CI_RUN_ID)" --attempt "$(H2A_CI_RUN_ATTEMPT)" --head "$(H2A_HEAD_SHA)" --base "$(H2A_BASE_SHA)" --merge "$(H2A_MERGE_SHA)" --scope "$(SCOPE)"

gateway-release-check:
	$(gw_ports)
	@test "$(ENV)|$(API_PORT)|$(UI_PORT)|$(MAILDEV_UI_PORT)|$(GATEWAY_PORT)" = "$(GW_EVOL_ROW_$(DELIVERY))" || { echo 'ERROR: delivery ENV/ports mismatch' >&2; exit 1; }
	$(gw_manifest)
	@$(GW_EVOL_RUN) node tools/gateway-evolution/run.mjs release-check --delivery "$(DELIVERY)" --program "$(CONSUMER_PROGRAM)" --manifest "$(ARTIFACT_MANIFEST)" --run-id "$(H2A_CI_RUN_ID)" --attempt "$(H2A_CI_RUN_ATTEMPT)" --head "$(H2A_HEAD_SHA)" --base "$(H2A_BASE_SHA)" --merge "$(H2A_MERGE_SHA)"

gateway-candidate-bundle:
	$(gw_manifest)
	@test -n "$(H2A_WORKTREE)" -a -d "$(H2A_WORKTREE)" || { echo 'ERROR: registered H2A_WORKTREE required' >&2; exit 1; }
	@$(GW_EVOL_RUN) node tools/gateway-evolution/run.mjs candidate-bundle --program "$(PROGRAM)" --delivery "$(DELIVERY)" --manifest "$(ARTIFACT_MANIFEST)" --worktree "$(H2A_WORKTREE)" --mode "$(MODE)"

gateway-client-fixtures:
	$(gw_manifest)
	@test -n "$(CLIENTS)" || { echo 'ERROR: CLIENTS required' >&2; exit 1; }
	@$(GW_EVOL_RUN) node tools/gateway-evolution/run.mjs client-fixtures --manifest "$(ARTIFACT_MANIFEST)" --clients "$(CLIENTS)"

gateway-client-e2e:
	$(gw_manifest)
	$(gw_ports)
	@test -n "$(CLIENTS)" -a -n "$(RUN_CONTEXT)" || { echo 'ERROR: CLIENTS and RUN_CONTEXT required' >&2; exit 1; }
	@$(GW_EVOL_RUN) node tools/gateway-evolution/run.mjs client-e2e --manifest "$(ARTIFACT_MANIFEST)" --context "$(RUN_CONTEXT)" --clients "$(CLIENTS)" --h2a-worktree "$(H2A_WORKTREE)" --scenarios "$(SCENARIOS)"
