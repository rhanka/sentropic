.PHONY: test-artifact-content-manifests
test-artifact-content-manifests: ## Render and qualify closed content infrastructure without cluster access
	@case "$(ENV)" in test-*) ;; *) echo "ERROR: use ENV=test-*"; exit 1 ;; esac
	@set -eu; rendered="$$(mktemp -d)"; trap 'rm -rf "$$rendered"' EXIT; \
	cp -R deploy/k8s "$$rendered/k8s"; \
	for tier in prod preprod; do \
		docker run --rm --network none -v "$(CURDIR)/deploy/k8s:/workspace:ro" \
			$(IDP_SYNC_KUBECTL_IMAGE) kustomize /workspace/overlays/$$tier > "$$rendered/$$tier.yaml"; \
		printf '\nimages:\n  - name: rg.fr-par.scw.cloud/nc-reg/sentropic-api\n    digest: sha256:%s\n' \
			$$(printf 'a%.0s' $$(seq 1 64)) >> "$$rendered/k8s/overlays/$$tier/kustomization.yaml"; \
		docker run --rm --network none -v "$$rendered/k8s:/workspace:ro" \
			$(IDP_SYNC_KUBECTL_IMAGE) kustomize /workspace/overlays/$$tier > "$$rendered/$$tier-pinned.yaml"; \
	done; \
	docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp \
		-v "$(CURDIR)/deploy/ci/artifact-content:/tests:ro" -v "$$rendered:/rendered:ro" \
		-v "$(CURDIR)/packages/artifacts/src:/routing:ro" \
		$(LLM_MESH_NODE_IMAGE)@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 \
		sh -ec 'npm install --prefix /tmp/content-tools --ignore-scripts --no-audit --no-fund yaml@2.8.1 >/dev/null; node /tests/bundle.selftest.mjs'
