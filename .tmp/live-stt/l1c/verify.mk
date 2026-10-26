include Makefile
ifneq ($(ENV),test-live-stt-l1c)
$(error This adapter requires ENV=test-live-stt-l1c)
endif
L1C_COMPOSE = docker compose -p $(ENV) -f docker-compose.immo-861.yml
L1C_RUN = $(L1C_COMPOSE) run --rm --no-deps -T
L1C_COLD_RUN = $(L1C_RUN) -u $(shell id -u):$(shell id -g) -e CM_PEER_TOOLS="$(CLUSTER_MESH_PEER_TOOLS)" -e MANIFEST_HEAD_SHA=$(shell git rev-parse HEAD) -v $(CURDIR):/source qualification
version:
	@$(L1C_RUN) qualification sh -ec 'npm view @sentropic/cluster-mesh version; npm view @sentropic/llm-mesh version; npm view @sentropic/llm-gateway version'

scope-check:
	@files="$$( { git diff --cached --name-only; git diff --name-only; } | sort -u | paste -sd, - )"; harness check scope --branch-md "$(CURDIR)/BRANCH.md" --staged-files "$$files"

test-cluster-mesh:
ifeq ($(L1C_PACKED),1)
	@$(L1C_COLD_RUN) sh -ec 'sed '\''/^case /,$$d'\'' /source/packages/cluster-mesh/tests/storage/cold-workspace.sh > /tmp/l1c-cold.sh; cat /source/.tmp/live-stt/l1/tuple-tail.sh >> /tmp/l1c-cold.sh; sh /tmp/l1c-cold.sh'
else
	@$(MAKE) cluster-mesh-workspace CM_ACTION=test CM_RUN="$(L1C_RUN)" CM_RUN_IMAGE=qualification ENV=$(ENV)
endif
lint-cluster-mesh:
	@$(L1C_COLD_RUN) sh -ec 'sed '\''/^case /,$$d'\'' /source/packages/cluster-mesh/tests/storage/cold-workspace.sh > /tmp/l1c-quality.sh; cat /source/.tmp/live-stt/l1c/quality-tail.sh >> /tmp/l1c-quality.sh; sh /tmp/l1c-quality.sh'
typecheck-cluster-mesh:
	@$(MAKE) cluster-mesh-workspace CM_ACTION=typecheck CM_RUN="$(L1C_RUN)" CM_RUN_IMAGE=qualification ENV=$(ENV)
build-cluster-mesh:
	@$(MAKE) cluster-mesh-workspace CM_ACTION=build CM_RUN="$(L1C_RUN)" CM_RUN_IMAGE=qualification ENV=$(ENV)
down:
	@$(L1C_COMPOSE) down --volumes --remove-orphans
