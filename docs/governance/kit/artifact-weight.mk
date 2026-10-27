# BR84-EX1: isolated, removable artifact qualification lane; no application services.
ARTIFACT_NODE_IMAGE ?= node:24.22.1-bookworm-slim
ARTIFACT_PROBE_IMAGE ?= mcr.microsoft.com/playwright:v1.63.0
ARTIFACT_RUN = docker run --rm --cpus=2 --memory=2048m --pids-limit=256 -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace" -w /workspace/docs/governance/kit

.PHONY: check-artifact-budget build-artifact-budget probe-artifact-budget
check-artifact-budget: ## Build and enforce dossier artifact budgets, including cold/offline browser probes
	@$(MAKE) build-artifact-budget ENV=$(ENV)
	@$(MAKE) probe-artifact-budget ENV=$(ENV)

build-artifact-budget: ## Test data boundaries and build baseline, typical and full-governance fixtures
	@$(ARTIFACT_RUN) -e ARTIFACT_COMMIT="$$(git rev-parse HEAD)" $(ARTIFACT_NODE_IMAGE) sh -ec 'trap "rm -rf node_modules" EXIT; npm ci --force --no-audit --no-fund >/dev/null; node --test scripts/artifact-input.test.mjs scripts/portable.test.mjs scripts/artifact-budget.test.mjs; node scripts/build-artifact-fixture.mjs baseline; node scripts/build-artifact-fixture.mjs typical; node scripts/build-artifact-fixture.mjs governance; mkdir -p .cache; node scripts/check-geometry.mjs; node scripts/check-routing-budget.mjs'

probe-artifact-budget: ## Verify offline interactions and include cold startup requests in size accounting
	@$(ARTIFACT_RUN) $(ARTIFACT_PROBE_IMAGE) sh -ec 'npm install --prefix /tmp/artifact-probe --no-audit --no-fund playwright@1.63.0 >/dev/null; node scripts/check-artifact-browser.mjs; node scripts/check-artifact-startup.mjs; node scripts/check-governance-input-browser.mjs'
