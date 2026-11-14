# Run from the repository root with make -f ui-shared/templater/contract/Makefile.
ENV ?= feat-app-vue-t0
IMAGE ?= node:24-bookworm-slim
CONTRACT := ui-shared/templater/contract
.PHONY: test typecheck inventory
test typecheck:
	@test "$(ENV)" = feat-app-vue-t0 || { echo 'Expected isolated T0 environment'; exit 1; }
	docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache -v "$(CURDIR):/workspace:ro" -w /workspace $(IMAGE) sh -ec 'node scripts/ci/locked-tools.mjs --prefix /tmp/tools --ignore-scripts --no-audit --no-fund @types/node@22 eslint@9.39.1 typescript-eslint@8.48.1 typescript@5.4.5 vitest@4.0.18 >/dev/null; /tmp/tools/node_modules/.bin/tsc --outDir /tmp/templater-contract --strict --target es2022 --module nodenext --moduleResolution nodenext $(CONTRACT)/container.ts $(CONTRACT)/presentation.ts; NODE_PATH=/tmp/tools/node_modules node --test $(CONTRACT)/*.test.mjs'
inventory:
	docker run --rm -u "$$(id -u):$$(id -g)" -v "$(CURDIR):/workspace" -w /workspace $(IMAGE) node $(CONTRACT)/inventory.mjs
