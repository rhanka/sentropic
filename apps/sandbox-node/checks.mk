# Standalone qualification: no stack, no host dependencies, no deployment.
SANDBOX_NODE_IMAGE := node:24-alpine3.23@sha256:0468540aa58203ff9e40c2aab3907c52644ab818af6176b1c70a026137dc92a2
SANDBOX_NODE_NPM_CACHE ?= $(HOME)/.cache/sentropic-sandbox-node/npm
.PHONY: check-sandbox-node
qualify-sandbox-node-disk:
	@case "$(ENV)" in test-*) ;; *) echo 'isolated test ENV required'; exit 1;; esac
	@"$${QUAL_RELEASE_DIR:?verified qualification release required}/execution-node" --qualify-disk

qualify-sandbox-node-restart-mounts:
	@case "$(ENV)" in test-*) ;; *) echo 'isolated test ENV required'; exit 1;; esac
	@sh apps/sandbox-node/k8s/qualify-restart-mounts.sh

build-sandbox-node-artifact:
	@sh apps/sandbox-node/k8s/build-artifact.sh

verify-sandbox-node-artifact:
	@set -eu; out=apps/sandbox-node/k8s/out; digest=$$(cat "$$out/release.digest"); \
	sha256sum -c "$$out/SHA256SUMS"; \
	release=$$(mktemp -d "$$out/verify.XXXXXX"); trap 'rm -r "$$release"' EXIT; \
	tar -xf "$$out/$$digest.tar" -C "$$release"; \
	(cd "$$release"; sha256sum -c SHA256SUMS); \
	cmp "$$release/OPERATOR.md" apps/sandbox-node/OPERATOR.md; \
	for name in agent.env execution-node.service operator-ticket.ed25519.pub.pem qualify-restart-mounts.sh start.sh; do \
	  cmp "$$release/$$name" "apps/sandbox-node/k8s/$$name"; done; \
	docker run --rm --network=none --read-only -v "$(CURDIR)/$$release:/release:ro" \
	  --entrypoint /release/execution-node node:24-bookworm-slim@sha256:0e2646ab57e77b7a384a0cb59b6815b182c77e1f9c3ba36bd8435bd9c4e6680e --self-test

check-sandbox-node:
	@mkdir -p "$(SANDBOX_NODE_NPM_CACHE)"
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/npm-cache \
	  -v "$(SANDBOX_NODE_NPM_CACHE):/npm-cache" -v "$(CURDIR):/source:ro" $(SANDBOX_NODE_IMAGE) sh -ec '\
	  mkdir -p /tmp/qualification/apps/sandbox-node; \
	  tar -C /source/apps/sandbox-node --exclude=k8s/out -cf - . | tar -xf - -C /tmp/qualification/apps/sandbox-node; \
	  mkdir -p /tmp/qualification/spec; cp /source/spec/SPEC_EVOL_SANDBOX_NODE.md /tmp/qualification/spec/; \
	  node /source/scripts/ci/locked-tools.mjs --prefix /tmp/qualification --ignore-scripts --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node >/dev/null; \
	  cd /tmp/qualification/apps/sandbox-node; \
	  sh -n k8s/start.sh k8s/build-artifact.sh k8s/qualify-restart-mounts.sh; \
	  ../../node_modules/.bin/tsc --project tsconfig.json; \
	  ../../node_modules/.bin/tsc --project tsconfig.build.json; \
	  node --expose-gc tests/export-memory.mjs; \
	  ../../node_modules/.bin/vitest run --config vitest.config.ts $(SCOPE)'
