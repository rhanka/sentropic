# Standalone qualification: no stack, no host dependencies, no deployment.
SANDBOX_NODE_IMAGE := node:24-alpine3.23@sha256:0468540aa58203ff9e40c2aab3907c52644ab818af6176b1c70a026137dc92a2
.PHONY: check-sandbox-node
build-sandbox-node-artifact:
	@sh apps/sandbox-node/k8s/build-artifact.sh

check-sandbox-node:
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/npm-cache \
	  -v "$(HOME)/.npm:/npm-cache" -v "$(CURDIR):/source:ro" $(SANDBOX_NODE_IMAGE) sh -ec '\
	  mkdir -p /tmp/qualification/apps; cp -R /source/apps/sandbox-node /tmp/qualification/apps/; \
	  node /source/scripts/ci/locked-tools.mjs --prefix /tmp/qualification --ignore-scripts --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node >/dev/null; \
	  cd /tmp/qualification/apps/sandbox-node; \
	  ../../node_modules/.bin/tsc --project tsconfig.json; \
	  ../../node_modules/.bin/vitest run --config vitest.config.ts'
