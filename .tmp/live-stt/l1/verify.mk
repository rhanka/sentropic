include Makefile

ifeq ($(filter $(ENV),test-live-stt-l1 test-llm-judge),)
$(error This verification adapter requires ENV=test-live-stt-l1 or ENV=test-llm-judge)
endif

L1_COMPOSE = docker compose -p $(ENV) -f docker-compose.immo-861.yml
L1_RUN = $(L1_COMPOSE) run --rm --no-deps -T -u $(shell id -u):$(shell id -g) -w /workspace/packages/llm-mesh qualification
L1_TOOLS = npm_config_cache=/tmp/npm-cache npm install --prefix /tmp/l1-tools --ignore-scripts --no-audit --no-fund vitest@4.0.18 typescript@5.4.5 @types/node@22.10.10 >/dev/null

scope-check:
	@files="$$( { git diff --cached --name-only; git diff --name-only; } | sort -u | paste -sd, - )"; harness check scope --branch-md "$(CURDIR)/BRANCH.md" --staged-files "$$files"

test-llm-mesh:
	$(L1_RUN) sh -ec '$(L1_TOOLS); NODE_PATH=/tmp/l1-tools/node_modules /tmp/l1-tools/node_modules/.bin/vitest run $(or $(SCOPE),tests) --environment node --maxWorkers=2'

typecheck-llm-mesh:
	$(L1_RUN) sh -ec '$(L1_TOOLS); /tmp/l1-tools/node_modules/.bin/tsc --noEmit -p tsconfig.json; mkdir /tmp/l1-types; cp -r src tests package.json /tmp/l1-types/; ln -s /tmp/l1-tools/node_modules /tmp/l1-types/node_modules; cd /tmp/l1-types; /tmp/l1-tools/node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext tests/speech-contract.test.ts'

lint-llm-mesh:
	$(L1_RUN) sh -ec 'npm_config_cache=/tmp/npm-cache npm install --prefix /tmp/l1-lint --ignore-scripts --no-audit --no-fund eslint@10.0.2 typescript-eslint@8.56.1 >/dev/null; printf "%s\n" "import tseslint from \"typescript-eslint\";" "export default tseslint.config(...tseslint.configs.recommended, { rules: { \"@typescript-eslint/no-empty-object-type\": \"off\", \"@typescript-eslint/no-explicit-any\": \"off\", \"@typescript-eslint/no-unused-vars\": \"off\" } });" > /tmp/l1-lint/eslint.config.mjs; /tmp/l1-lint/node_modules/.bin/eslint --config /tmp/l1-lint/eslint.config.mjs src/speech src/capabilities.ts src/catalog.ts src/index.ts tests/speech-contract.test.ts'

build-llm-mesh:
	$(L1_RUN) sh -ec '$(L1_TOOLS); /tmp/l1-tools/node_modules/.bin/tsc -p tsconfig.json; npm view @sentropic/llm-mesh version; npm pack --ignore-scripts --pack-destination /tmp --json > /tmp/l1-pack.json; node /workspace/.tmp/live-stt/l1/packed-check.mjs /tmp/l1-pack.json /tmp/l1-tools/node_modules/.bin/tsc $(if $(filter 1,$(L1_REFRESH_LOCK)),--refresh-lock)'

down:
	$(L1_COMPOSE) down --volumes --remove-orphans
