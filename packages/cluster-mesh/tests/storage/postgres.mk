# Branch-local storage tooling; the repository Makefile and Compose files
# remain unchanged. Invoke with -f Makefile -f this-file.
.PHONY: cluster-mesh-pg-package-info
cluster-mesh-pg-package-info:
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; \
		task_dir="$$(mktemp -d)"; cd "$$task_dir"; \
		npm_config_cache=/tmp/npm-cache npm view @stablelib/sha256@2.0.1 version dist.integrity dependencies --json; \
		npm_config_cache=/tmp/npm-cache npm pack @stablelib/sha256@2.0.1 --silent >/dev/null; \
		tar -xzf stablelib-sha256-2.0.1.tgz; \
		sed -n "1,180p" package/lib/sha256.d.ts'

.PHONY: cluster-mesh-storage-deps cluster-mesh-storage-deps-audit
cluster-mesh-storage-deps:
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; \
		task_dir=/workspace/.h2a/storage-deps; mkdir -p "$$task_dir" packages/cluster-mesh/node_modules; \
		cp packages/cluster-mesh/tests/storage/storage-deps.package.json "$$task_dir/package.json"; \
		npm_config_cache=/tmp/npm-cache npm install --prefix "$$task_dir" --ignore-scripts --no-audit --no-fund; \
		if [ ! -e packages/cluster-mesh/node_modules/@stablelib ] && [ ! -L packages/cluster-mesh/node_modules/@stablelib ]; then \
			ln -s /workspace/.h2a/storage-deps/node_modules/@stablelib packages/cluster-mesh/node_modules/@stablelib; \
		fi'

cluster-mesh-storage-deps-audit: cluster-mesh-storage-deps
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace $(LLM_MESH_NODE_IMAGE) sh -lc \
		'npm_config_cache=/tmp/npm-cache npm audit --prefix .h2a/storage-deps --omit=dev --audit-level=high'

.PHONY: cluster-mesh-storage-lock-import
cluster-mesh-storage-lock-import:
	@docker run --rm -u "$$(id -u):$$(id -g)" -v "$(CURDIR):/workspace" -w /workspace $(LLM_MESH_NODE_IMAGE) \
		node packages/cluster-mesh/tests/storage/import-digest-lock.mjs

CM_PG_NAME := cm-storage-$(ENV)
CM_PG_IMAGE := postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24
.PHONY: cluster-mesh-pg-up cluster-mesh-pg-down cluster-mesh-pg-test
cluster-mesh-pg-up:
	@case "$(ENV)" in test-*|e2e-*) ;; *) echo 'Postgres qualification requires test-* or e2e-*'; exit 1;; esac
	@docker network inspect "$(CM_PG_NAME)" >/dev/null 2>&1 || docker network create "$(CM_PG_NAME)" >/dev/null
	@docker container inspect "$(CM_PG_NAME)" >/dev/null 2>&1 || docker run -d --name "$(CM_PG_NAME)" --network "$(CM_PG_NAME)" \
		--label sentropic.storage-test="$(ENV)" -e POSTGRES_PASSWORD=qualification-only -e POSTGRES_DB=storage_test "$(CM_PG_IMAGE)" >/dev/null
	@if [ "$$(docker container inspect --format '{{.State.Running}}' "$(CM_PG_NAME)")" != true ]; then docker start "$(CM_PG_NAME)" >/dev/null; fi
	@attempt=0; until docker exec "$(CM_PG_NAME)" pg_isready -U postgres -d storage_test >/dev/null; do \
		attempt=$$((attempt+1)); [ "$$attempt" -lt 30 ] || exit 1; sleep 1; done

cluster-mesh-pg-down:
	@case "$(ENV)" in test-*|e2e-*) ;; *) exit 1;; esac
	@if docker container inspect "$(CM_PG_NAME)" >/dev/null 2>&1; then \
		[ "$$(docker container inspect --format '{{ index .Config.Labels "sentropic.storage-test" }}' "$(CM_PG_NAME)")" = "$(ENV)" ] || exit 1; \
		docker rm -fv "$(CM_PG_NAME)" >/dev/null; fi
	@docker network rm "$(CM_PG_NAME)" >/dev/null 2>&1 || true

cluster-mesh-pg-test: cluster-mesh-pg-up cluster-mesh-storage-deps
	@docker run --rm --init --network "$(CM_PG_NAME)" -u "$$(id -u):$$(id -g)" -e HOME=/tmp \
		-e CM_PG_URL="postgresql://postgres:qualification-only@$(CM_PG_NAME):5432/storage_test" \
		-e CM_PG_CRASH_PHASE="$(CM_PG_CRASH_PHASE)" \
		-v "$(CURDIR):/workspace" -w /workspace/packages/cluster-mesh $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; \
		tool_dir=/workspace/.h2a/storage-pg-tools; mkdir -p "$$tool_dir"; \
		npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --ignore-scripts --no-audit --no-fund pg@8.16.3 vitest@4.1.5 typescript@5.4.5 @types/node >/dev/null; \
		ln -sfn "$$tool_dir/node_modules/pg" node_modules/pg; \
		trap "rm -f node_modules/pg" EXIT; \
		NODE_PATH="$$tool_dir/node_modules" "$$tool_dir/node_modules/.bin/vitest" run "$(if $(SCOPE),$(SCOPE),tests/storage/postgres-)" --environment node --maxWorkers=1'

.PHONY: cluster-mesh-pg-diagnostics
cluster-mesh-pg-diagnostics:
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace $(LLM_MESH_NODE_IMAGE) sh -lc \
		'df -h /workspace /tmp; node --version; node .h2a/storage-pg-tools/node_modules/vitest/vitest.mjs --version'

.PHONY: cluster-mesh-pg-manifest
cluster-mesh-pg-manifest:
	@docker run --rm -u "$$(id -u):$$(id -g)" -v "$(CURDIR):/workspace" -w /workspace $(LLM_MESH_NODE_IMAGE) \
		node packages/cluster-mesh/tests/storage/generate-pg-manifest.mjs

.PHONY: cluster-mesh-comments-package-info
cluster-mesh-comments-package-info:
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp $(LLM_MESH_NODE_IMAGE) sh -lc \
		'npm_config_cache=/tmp/npm-cache npm view @sentropic/comments version exports dependencies dist.integrity --json'

.PHONY: cluster-mesh-comments-deps cluster-mesh-comments-oracle
cluster-mesh-comments-deps:
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; \
		task_dir=/workspace/.h2a/comments-deps; mkdir -p "$$task_dir" node_modules/@sentropic; \
		cp packages/cluster-mesh/tests/storage/comments-deps.package.json "$$task_dir/package.json"; \
		npm_config_cache=/tmp/npm-cache npm install --prefix "$$task_dir" --ignore-scripts --no-audit --no-fund; \
		if [ ! -e node_modules/@sentropic/comments ] && [ ! -L node_modules/@sentropic/comments ]; then \
			ln -s /workspace/.h2a/comments-deps/node_modules/@sentropic/comments node_modules/@sentropic/comments; fi'

cluster-mesh-comments-oracle: cluster-mesh-comments-deps
	@docker run --rm -u "$$(id -u):$$(id -g)" -v "$(CURDIR):/workspace" -w /workspace $(LLM_MESH_NODE_IMAGE) \
		node packages/cluster-mesh/tests/storage/package-comments-oracle.mjs

.PHONY: cluster-mesh-pg-crash cluster-mesh-pg-crash-test
cluster-mesh-pg-crash:
	@case "$(ENV)" in test-*|e2e-*) ;; *) exit 1;; esac
	@[ "$$(docker container inspect --format '{{ index .Config.Labels "sentropic.storage-test" }}' "$(CM_PG_NAME)")" = "$(ENV)" ]
	@docker kill --signal KILL "$(CM_PG_NAME)" >/dev/null
	@docker start "$(CM_PG_NAME)" >/dev/null
	@$(MAKE) -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk cluster-mesh-pg-up API_PORT=$(API_PORT) UI_PORT=$(UI_PORT) MAILDEV_UI_PORT=$(MAILDEV_UI_PORT) ENV=$(ENV)

cluster-mesh-pg-crash-test:
	@$(MAKE) -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk cluster-mesh-pg-test SCOPE=postgres-crashes.spec.ts CM_PG_CRASH_PHASE=seed API_PORT=$(API_PORT) UI_PORT=$(UI_PORT) MAILDEV_UI_PORT=$(MAILDEV_UI_PORT) ENV=$(ENV)
	@$(MAKE) -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk cluster-mesh-pg-crash API_PORT=$(API_PORT) UI_PORT=$(UI_PORT) MAILDEV_UI_PORT=$(MAILDEV_UI_PORT) ENV=$(ENV)
	@$(MAKE) -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk cluster-mesh-pg-test SCOPE=postgres-crashes.spec.ts CM_PG_CRASH_PHASE=verify API_PORT=$(API_PORT) UI_PORT=$(UI_PORT) MAILDEV_UI_PORT=$(MAILDEV_UI_PORT) ENV=$(ENV)
