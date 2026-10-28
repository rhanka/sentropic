# Explicit local opt-in only; neither provisioning nor inference is a CI prerequisite.
KEV_CACHE := $(abspath $(shell git rev-parse --git-common-dir)/../tmp/cache/decision-v4l4)
.PHONY: decision-kev-provision decision-kev-smoke
decision-kev-provision:
	@test "$(ENV)" = test-decision-l4 && test -z "$$CI" && test -z "$$GITHUB_ACTIONS"
	@flock /home/antoinefa/.cache-tmp/sentropic-docker.lock bash scripts/decision/kev-provision.sh "$(KEV_CACHE)"
decision-kev-smoke:
	@test "$(ENV)" = test-decision-l4 && test -z "$$CI" && test -z "$$GITHUB_ACTIONS"
	@flock /home/antoinefa/.cache-tmp/sentropic-docker.lock bash scripts/decision/kev-smoke.sh "$(KEV_CACHE)"
