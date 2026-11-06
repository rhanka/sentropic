.PHONY: test-artifact-content-manifests
test-artifact-content-manifests: ## Render and qualify closed content infrastructure without cluster access
	@case "$(ENV)" in test-*) ;; *) echo "ERROR: use ENV=test-*"; exit 1 ;; esac
	@set -eu; rendered="$$(mktemp -d)"; trap 'rm -rf "$$rendered"' EXIT; \
	cp -R deploy/k8s "$$rendered/k8s"; \
	for tier in prod preprod; do \
		docker run --rm --network none -v "$(CURDIR)/deploy/k8s:/workspace:ro" \
			$(IDP_SYNC_KUBECTL_IMAGE) kustomize /workspace/overlays/$$tier > "$$rendered/$$tier.yaml"; \
		mkdir "$$rendered/k8s/overlays/$$tier-pinned"; \
		printf 'apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - ../%s\nimages:\n  - name: ghcr.io/rhanka/sentropic-api\n    digest: sha256:%s\n' \
			"$$tier" $$(printf 'a%.0s' $$(seq 1 64)) > "$$rendered/k8s/overlays/$$tier-pinned/kustomization.yaml"; \
		docker run --rm --network none -v "$$rendered/k8s:/workspace:ro" \
			$(IDP_SYNC_KUBECTL_IMAGE) kustomize /workspace/overlays/$$tier-pinned > "$$rendered/$$tier-pinned.yaml"; \
	done; \
	docker run --rm --network none -v "$(CURDIR)/deploy/k8s:/workspace:ro" \
		$(IDP_SYNC_KUBECTL_IMAGE) kustomize /workspace/overlays/preprod-a4 > "$$rendered/preprod-a4.yaml"; \
	docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp \
		-v "$(CURDIR)/deploy/ci/artifact-content:/tests:ro" -v "$$rendered:/rendered:ro" \
		-v "$(CURDIR)/packages/artifacts/src:/routing:ro" -v "$(CURDIR)/scripts/ci:/ci:ro" \
		-v "$(CURDIR)/deploy:/workspace/deploy:ro" -v "$(CURDIR)/docs:/workspace/docs:ro" \
		-w /workspace -e A4_YAML_PACKAGE=/tmp/content-tools/package.json \
		$(LLM_MESH_NODE_IMAGE)@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 \
		sh -ec 'node /ci/locked-tools.mjs --prefix /tmp/content-tools --ignore-scripts --no-audit --no-fund yaml@2.8.1 >/dev/null; node /tests/bundle.selftest.mjs; node --test /workspace/deploy/ci/preprod-a4/*.test.mjs; node /workspace/deploy/ci/preprod-a4/bundle.selftest.mjs'
