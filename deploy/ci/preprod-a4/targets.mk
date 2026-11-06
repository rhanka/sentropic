# Operator-side Node/kubectl only; values are inherited by name, never interpolated into argv.
export A4_PHASE ?= checkpoint
export A4_DRY_RUN ?= 1
export A4_KUBECONFIG_FILE
export A4_REQUEST_FILE
export A4_OPERATION
export A4_STAGE
export A4_REMOTE_FILE
export A4_REHEARSAL_FILE
.PHONY: k8s-preprod-a4-custody
k8s-preprod-a4-custody: ## Prepare the tenant custodian or stage protected inputs; dry-run by default
	@node deploy/ci/preprod-a4/ops.mjs
.PHONY: k8s-preprod-a4-prepare test-preprod-a4
k8s-preprod-a4-prepare: ## Prepare the owner-authorized A4 evidence; dry-run by default (see runbook)
	@node deploy/ci/preprod-a4/run.mjs

test-preprod-a4: ## Scoped operator, secret-composition and bundle preparation tests; no cluster
	@case "$(ENV)" in test-*) ;; *) echo 'ERROR: use ENV=test-*'; exit 1;; esac
	@docker run --rm -u "$$(id -u):$$(id -g)" -v "$(CURDIR):/workspace:ro" -w /workspace $(LLM_MESH_NODE_IMAGE) node --test deploy/ci/preprod-a4/*.test.mjs

A4_TEST_IMAGE ?= $(API_TOOL_IMAGE)
.PHONY: test-preprod-a4-api
test-preprod-a4-api: ## Run preparation tests in a cached API toolbox with container-only source overlay
	@case "$(ENV)" in test-*) ;; *) echo 'ERROR: use ENV=test-*'; exit 1;; esac
	@docker run --rm -v "$(CURDIR):/input:ro" -w /workspace/api $(A4_TEST_IMAGE) sh -ec 'cp -R /input/api/src/. /workspace/api/src/; cp /input/api/tests/unit/auth/cm-preprod-*.test.ts /workspace/api/tests/unit/auth/; /workspace/node_modules/.bin/vitest run tests/unit/auth/cm-preprod-*.test.ts tests/unit/auth/cm-cutover-checkpoint.test.ts --no-file-parallelism'
