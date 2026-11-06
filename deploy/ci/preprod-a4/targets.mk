# Operator-side Node/kubectl only; values are inherited by name, never interpolated into argv.
export A4_PHASE ?= checkpoint
export A4_DRY_RUN ?= 1
export A4_KUBECONFIG_FILE
export A4_AUTHORIZATION_FILE
export A4_REQUEST_FILE
export A4_OPERATION
export A4_STAGE
export A4_REMOTE_FILE
export A4_REHEARSAL_FILE
export A4_BUDGETS_FILE
export A4_VERIFY_PHASE ?= internal
export A4_EXECUTION_FILE
export A4_EXECUTION_SHA256
export A4_ACTION
.PHONY: k8s-preprod-a4-action
k8s-preprod-a4-action: ## Execute one owner-approved immutable annex action; dry-run by default
	@case "$(ENV)" in test-*) ;; *) exit 1;; esac
	@node deploy/ci/preprod-a4/execution.mjs
.PHONY: k8s-preprod-a4-verify
k8s-preprod-a4-verify: ## Read-only internal gates; A4_VERIFY_PHASE=http additionally requires the restricted UI proxy
	@case "$(ENV)" in test-*) ;; *) exit 1;; esac
	@node deploy/ci/preprod-a4/verify.mjs
.PHONY: k8s-preprod-a4-custody
k8s-preprod-a4-custody: ## Prepare the tenant custodian or stage protected inputs; dry-run by default
	@case "$(ENV)" in test-*) ;; *) exit 1;; esac
	@node deploy/ci/preprod-a4/ops.mjs
.PHONY: k8s-preprod-a4-prepare test-preprod-a4
k8s-preprod-a4-prepare: ## Prepare the owner-authorized A4 evidence; dry-run by default (see runbook)
	@case "$(ENV)" in test-*) ;; *) exit 1;; esac
	@node deploy/ci/preprod-a4/run.mjs

test-preprod-a4: ## Scoped operator, secret-composition and bundle preparation tests; no cluster
	@case "$(ENV)" in test-*) ;; *) echo 'ERROR: use ENV=test-*'; exit 1;; esac
	@docker run --rm -u "$$(id -u):$$(id -g)" -v "$(CURDIR):/workspace:ro" -w /workspace $(LLM_MESH_NODE_IMAGE) node --test deploy/ci/preprod-a4/*.test.mjs

A4_TEST_IMAGE ?= $(API_TOOL_IMAGE)
.PHONY: test-preprod-a4-api
test-preprod-a4-api: ## Run preparation tests in a cached API toolbox with container-only source overlay
	@case "$(ENV)" in test-*) ;; *) echo 'ERROR: use ENV=test-*'; exit 1;; esac
	@docker run --rm -e NODE_ENV=test -e SCW_TEM_SECRET_KEY=a4-isolated-synthetic -v "$(CURDIR):/input:ro" -w /workspace/api $(A4_TEST_IMAGE) sh -ec 'cp -R /input/api/src/. /workspace/api/src/; cp /input/api/tests/unit/auth/cm-preprod-*.test.ts /workspace/api/tests/unit/auth/; /workspace/node_modules/.bin/vitest run tests/unit/auth/cm-preprod-*.test.ts tests/unit/auth/cm-cutover-checkpoint.test.ts --no-file-parallelism'

.PHONY: test-preprod-a4-manifests check-preprod-a4-api
test-preprod-a4-manifests: ## Render the real prod/preprod overlays and check custody without a cluster
	@case "$(ENV)" in test-*) ;; *) echo 'ERROR: use ENV=test-*'; exit 1;; esac
	@set -eu; rendered="$$(mktemp -d)"; trap 'rm -rf "$$rendered"' EXIT; \
	for tier in prod preprod preprod-a4; do kubectl kustomize deploy/k8s/overlays/$$tier > "$$rendered/$$tier.yaml"; done; \
	docker run --rm -v "$(CURDIR)/deploy/ci/preprod-a4:/tests:ro" -v "$$rendered:/rendered:ro" $(A4_TEST_IMAGE) node /tests/bundle.selftest.mjs

check-preprod-a4-api: ## Typecheck, lint and build the candidate API, then check the bundle CLI without DB access
	@case "$(ENV)" in test-*) ;; *) echo 'ERROR: use ENV=test-*'; exit 1;; esac
	@docker run --rm -e NODE_ENV=test -e SCW_TEM_SECRET_KEY=a4-isolated-synthetic -v "$(CURDIR):/input:ro" -w /workspace/api $(A4_TEST_IMAGE) sh -ec 'cp -R /input/api/src/. /workspace/api/src/; npm run typecheck; /workspace/node_modules/.bin/eslint src/scripts/cm-preprod-*.ts src/services/identity/cm-cutover-checkpoint.ts src/services/identity/cm-import-source.ts; npm run build; node /input/deploy/ci/preprod-a4/check-bundle.mjs'
