include Makefile
ifneq ($(ENV),test-live-stt-l1c)
$(error This adapter requires ENV=test-live-stt-l1c)
endif
L1C_COMPOSE = docker compose -p $(ENV) -f docker-compose.immo-861.yml
L1C_RUN = $(L1C_COMPOSE) run --rm --no-deps -T

scope-check:
	@files="$$( { git diff --cached --name-only; git diff --name-only; } | sort -u | paste -sd, - )"; harness check scope --branch-md "$(CURDIR)/BRANCH.md" --staged-files "$$files"

test-cluster-mesh:
	@$(MAKE) cluster-mesh-workspace CM_ACTION=test CM_RUN="$(L1C_RUN)" CM_RUN_IMAGE=qualification ENV=$(ENV)
typecheck-cluster-mesh:
	@$(MAKE) cluster-mesh-workspace CM_ACTION=typecheck CM_RUN="$(L1C_RUN)" CM_RUN_IMAGE=qualification ENV=$(ENV)
build-cluster-mesh:
	@$(MAKE) cluster-mesh-workspace CM_ACTION=build CM_RUN="$(L1C_RUN)" CM_RUN_IMAGE=qualification ENV=$(ENV)
down:
	@$(L1C_COMPOSE) down --volumes --remove-orphans
