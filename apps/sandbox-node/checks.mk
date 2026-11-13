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

check-sandbox-node:
	@mkdir -p "$(SANDBOX_NODE_NPM_CACHE)"
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/npm-cache \
	  -v "$(SANDBOX_NODE_NPM_CACHE):/npm-cache" -v "$(CURDIR):/source:ro" $(SANDBOX_NODE_IMAGE) sh -ec '\
	  mkdir -p /tmp/qualification/apps/sandbox-node; \
	  tar -C /source/apps/sandbox-node --exclude=k8s/out -cf - . | tar -xf - -C /tmp/qualification/apps/sandbox-node; \
	  node /source/scripts/ci/locked-tools.mjs --prefix /tmp/qualification --ignore-scripts --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node >/dev/null; \
	  cd /tmp/qualification/apps/sandbox-node; \
	  sh -n k8s/start.sh k8s/build-artifact.sh k8s/qualify-restart-mounts.sh; \
	  ../../node_modules/.bin/tsc --project tsconfig.json; \
	  ../../node_modules/.bin/tsc --project tsconfig.build.json; \
	  node --expose-gc tests/export-memory.mjs; \
	  ../../node_modules/.bin/vitest run --config vitest.config.ts $(SCOPE)'
