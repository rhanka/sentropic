# BR85a-EX1: use the exact qualified toolbox; cache diagnostics, never verdicts.
CI_STATIC_CACHE := $(CURDIR)/tmp/ci-static
CI_STATIC_RUN = docker run --rm --pull=never --network none -u "$$(id -u):$$(id -g)" -v "$(CI_STATIC_CACHE):/ci-cache"

.PHONY: ci-typecheck-api ci-lint-api ci-static-join ci-artifacts-join test-ci-static
ci-typecheck-api: ci-test-env
	@mkdir -p "$(CI_STATIC_CACHE)"
	@$(CI_STATIC_RUN) -w /workspace/api $(API_TOOL_IMAGE) ./../node_modules/.bin/tsc --noEmit --incremental --tsBuildInfoFile /ci-cache/api.tsbuildinfo
	@$(CI_STATIC_RUN) -w /workspace $(API_TOOL_IMAGE) ./node_modules/.bin/tsc --noEmit --project apps/auth-idp/tsconfig.json --incremental --tsBuildInfoFile /ci-cache/idp.tsbuildinfo

ci-lint-api: ci-test-env
	@mkdir -p "$(CI_STATIC_CACHE)"
	@$(CI_STATIC_RUN) -w /workspace/api $(API_TOOL_IMAGE) npm run lint -- --cache --cache-strategy content --cache-location /ci-cache/api.eslintcache

ci-static-join: ci-test-env
	@test "$(CI_TYPECHECK_RESULT)" = success
	@test "$(CI_LINT_RESULT)" = success
	@test "$(CI_IDP_WEB_RESULT)" = success

ci-artifacts-join: ci-test-env
	@test "$(CI_ARTIFACT_RESULT)" = success

test-ci-static: ci-test-env
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace:ro" -w /workspace $(MANIFEST_GUARD_IMAGE) sh -ec '$(CI_EXPECTED_TOOLS); node --test scripts/ci/ci-static.test.mjs'

# BR92-EX1: tested-tree shortcut, same-tree PR evidence or the complete run.
.PHONY: test-ci-tested-tree
test-ci-tested-tree: ci-test-env
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace:ro" -w /workspace $(MANIFEST_GUARD_IMAGE) sh -ec '$(CI_EXPECTED_TOOLS); node --test scripts/ci/tested-tree.test.mjs'
