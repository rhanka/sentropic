# Standalone qualification: no stack, no host dependencies, no deployment.
SANDBOX_NODE_IMAGE := node:24-alpine3.23@sha256:0468540aa58203ff9e40c2aab3907c52644ab818af6176b1c70a026137dc92a2
SANDBOX_NODE_NPM_CACHE ?= $(HOME)/.cache/sentropic-sandbox-node/npm
.PHONY: check-sandbox-node
lock-sandbox-node-build-tools:
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR)/apps/sandbox-node/k8s/build-tools:/tools" -w /tools $(SANDBOX_NODE_IMAGE) sh -ec 'npm install --package-lock-only --ignore-scripts --no-audit --no-fund; node -e '\''const fs=require("node:fs");fs.writeFileSync("package-lock.json", JSON.stringify(JSON.parse(fs.readFileSync("package-lock.json")))+"\n")'\'''
qualify-sandbox-node-disk:
	@case "$(ENV)" in test-*) ;; *) echo 'isolated test ENV required'; exit 1;; esac
	@"$${QUAL_RELEASE_DIR:?verified qualification release required}/execution-node" --qualify-disk

build-sandbox-node-artifact:
	@sh apps/sandbox-node/k8s/build-artifact.sh

check-sandbox-node:
	@mkdir -p "$(SANDBOX_NODE_NPM_CACHE)"
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/npm-cache \
	  -v "$(SANDBOX_NODE_NPM_CACHE):/npm-cache" -v "$(CURDIR):/source:ro" $(SANDBOX_NODE_IMAGE) sh -ec '\
	  mkdir -p /tmp/qualification/apps; cp -R /source/apps/sandbox-node /tmp/qualification/apps/; \
	  node /source/scripts/ci/locked-tools.mjs --prefix /tmp/qualification --ignore-scripts --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node >/dev/null; \
	  cd /tmp/qualification/apps/sandbox-node; \
	  sh -n k8s/start.sh k8s/build-artifact.sh; \
	  ../../node_modules/.bin/tsc --project tsconfig.json; \
	  ../../node_modules/.bin/tsc --project tsconfig.build.json; \
	  node --expose-gc tests/export-memory.mjs; \
	  ../../node_modules/.bin/vitest run --config vitest.config.ts'
