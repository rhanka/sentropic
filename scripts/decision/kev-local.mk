# Explicit local opt-in only; neither provisioning nor inference is a CI prerequisite.
KEV_CACHE := $(abspath $(shell git rev-parse --git-common-dir)/../tmp/cache/decision-v4l4)
.PHONY: decision-kev-provision decision-kev-smoke
decision-kev-provision:
	@test "$(ENV)" = test-decision-l4 && test -z "$$CI" && test -z "$$GITHUB_ACTIONS"
	@flock /home/antoinefa/.cache-tmp/sentropic-docker.lock bash scripts/decision/kev-provision.sh "$(KEV_CACHE)"
decision-kev-smoke:
	@test "$(ENV)" = test-decision-l4 && test -z "$$CI" && test -z "$$GITHUB_ACTIONS"
	@flock /home/antoinefa/.cache-tmp/sentropic-docker.lock bash scripts/decision/kev-smoke.sh "$(KEV_CACHE)"

.PHONY: decision-kev-smoke-client
decision-kev-smoke-client:
	@test "$(ENV)" = test-decision-l4 && test -z "$$CI" && test -z "$$GITHUB_ACTIONS"
	@docker run --rm --network host -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e KEV_CACHE_HOST -e KEV_VERIFY_ONLY \
		-v "$(CURDIR):/workspace:ro" -v "$(KEV_CACHE):/kev-cache" -v /proc:/kev-host-proc:ro \
		-w /workspace $(LLM_MESH_NODE_IMAGE) node scripts/decision/kev-smoke.mjs

.PHONY: decision-kev-verify-provenance
decision-kev-verify-provenance:
	@test "$(ENV)" = test-decision-l4 && test -z "$$CI" && test -z "$$GITHUB_ACTIONS"
	@flock /home/antoinefa/.cache-tmp/sentropic-docker.lock bash scripts/decision/kev-attestation.sh "$(KEV_CACHE)"
