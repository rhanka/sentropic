.PHONY: test-artifact-data-guard
test-artifact-data-guard: ## Fail any change that deletes artifact tables, the artifact object store, its volume or a bucket
	@case "$(ENV)" in test-*) ;; *) echo "ERROR: use ENV=test-*"; exit 1 ;; esac
	@set -eu; rendered="$$(mktemp -d)"; trap 'rm -rf "$$rendered"' EXIT; \
	for tier in prod preprod preprod-a4; do \
		docker run --rm --network none -v "$(CURDIR)/deploy/k8s:/workspace:ro" \
			$(IDP_SYNC_KUBECTL_IMAGE) kustomize /workspace/overlays/$$tier > "$$rendered/$$tier.yaml"; \
	done; \
	docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e GUARD_YAML_PACKAGE=/tmp/guard-tools/package.json \
		-v "$(CURDIR):/workspace:ro" -v "$$rendered:/rendered:ro" -w /workspace \
		$(LLM_MESH_NODE_IMAGE)@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 \
		sh -ec 'node scripts/ci/locked-tools.mjs --prefix /tmp/guard-tools --ignore-scripts --no-audit --no-fund yaml@2.8.1 >/dev/null; node --test deploy/ci/artifact-data-guard/guard.test.mjs; node deploy/ci/artifact-data-guard/guard.mjs /workspace /rendered'
