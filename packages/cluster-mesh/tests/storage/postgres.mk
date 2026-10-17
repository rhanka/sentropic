# Isolated PostgreSQL qualification, accepted by BRCM2-EX5/EX9.
# Source tooling delegates to the root Makefile's disposable workspace.
.PHONY: cluster-mesh-pg-package-info
cluster-mesh-pg-package-info:
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; \
		task_dir="$$(mktemp -d)"; cd "$$task_dir"; \
		npm_config_cache=/tmp/npm-cache npm view @stablelib/sha256@2.0.1 version dist.integrity dependencies --json; \
		npm_config_cache=/tmp/npm-cache npm pack @stablelib/sha256@2.0.1 --silent >/dev/null; \
		tar -xzf stablelib-sha256-2.0.1.tgz; \
		sed -n "1,180p" package/lib/sha256.d.ts'

.PHONY: cluster-mesh-storage-deps cluster-mesh-storage-deps-audit cluster-mesh-cold-cleanup
cluster-mesh-cold-cleanup:
	@rm -rf node_modules packages/cluster-mesh/node_modules .h2a/storage-deps/node_modules .h2a/comments-deps/node_modules

cluster-mesh-storage-deps cluster-mesh-storage-deps-audit:
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; \
		task_dir=/tmp/storage-deps; mkdir -p "$$task_dir"; \
		cp packages/cluster-mesh/tests/storage/storage-deps.package.json "$$task_dir/package.json"; \
		npm_config_cache=/tmp/npm-cache npm install --prefix "$$task_dir" --ignore-scripts --no-audit --no-fund; \
		mkdir -p .h2a/storage-deps; cp "$$task_dir/package-lock.json" .h2a/storage-deps/; \
		npm_config_cache=/tmp/npm-cache npm audit --prefix "$$task_dir" --omit=dev --audit-level=high'

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

cluster-mesh-pg-test: cluster-mesh-pg-up
	@$(MAKE) cluster-mesh-workspace CM_ACTION=test CM_DOCKER_NETWORK="--network $(CM_PG_NAME)" \
		CM_PG_URL="postgresql://postgres:qualification-only@$(CM_PG_NAME):5432/storage_test" \
		SCOPE="$(if $(SCOPE),$(SCOPE),tests/storage/postgres-)" ENV=$(ENV)

.PHONY: cluster-mesh-pg-diagnostics
cluster-mesh-pg-diagnostics:
	@docker run --rm -v "$(CURDIR):/workspace" -w /workspace $(LLM_MESH_NODE_IMAGE) sh -lc \
		'df -h /workspace /tmp; node --version'

.PHONY: cluster-mesh-pg-manifest
cluster-mesh-pg-manifest:
	@docker run --rm -u "$$(id -u):$$(id -g)" -v "$(CURDIR):/workspace" -w /workspace $(LLM_MESH_NODE_IMAGE) \
		node packages/cluster-mesh/tests/storage/generate-pg-manifest.mjs

.PHONY: cluster-mesh-comments-package-info
cluster-mesh-comments-package-info:
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp $(LLM_MESH_NODE_IMAGE) sh -lc \
		'npm_config_cache=/tmp/npm-cache npm view @sentropic/comments version exports dependencies dist.integrity --json'

.PHONY: cluster-mesh-candidate-version
cluster-mesh-candidate-version:
	@docker run --rm -u "$$(id -u):$$(id -g)" -e npm_config_cache=/tmp/comments-registry-cache $(LLM_MESH_NODE_IMAGE) sh -lc \
		'npm view @sentropic/cluster-mesh version dist.integrity --registry=https://registry.npmjs.org --json'

.PHONY: cluster-mesh-comments-deps cluster-mesh-comments-oracle cluster-mesh-comments-deps-audit
cluster-mesh-comments-deps cluster-mesh-comments-deps-audit cluster-mesh-comments-oracle cluster-mesh-comments-vectors:
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; \
		task_dir=/tmp/comments-deps; mkdir -p "$$task_dir"; \
		cp packages/cluster-mesh/tests/storage/comments-deps.package.json "$$task_dir/package.json"; \
		npm_config_cache=/tmp/npm-cache npm install --prefix "$$task_dir" --ignore-scripts --no-audit --no-fund; \
		mkdir -p .h2a/comments-deps; cp "$$task_dir/package-lock.json" .h2a/comments-deps/; \
		npm_config_cache=/tmp/npm-cache npm audit --prefix "$$task_dir" --omit=dev --audit-level=high; \
		case "$@" in \
		  *oracle) CM_COMMENTS_DEPS="$$task_dir/package.json" node packages/cluster-mesh/tests/storage/package-comments-oracle.mjs ;; \
		  *vectors) CM_COMMENTS_DEPS="$$task_dir/package.json" node packages/cluster-mesh/tests/storage/generate-comments-vectors.mjs ;; \
		esac'

.PHONY: cluster-mesh-comments-vectors

.PHONY: cluster-mesh-comments-lock-import
cluster-mesh-comments-lock-import:
	@docker run --rm -u "$$(id -u):$$(id -g)" -v "$(CURDIR):/workspace" -w /workspace $(LLM_MESH_NODE_IMAGE) \
		node packages/cluster-mesh/tests/storage/import-comments-lock.mjs

.PHONY: cluster-mesh-comments-test
cluster-mesh-comments-test:
	@$(MAKE) -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk cluster-mesh-pg-test SCOPE=comments- API_PORT=$(API_PORT) UI_PORT=$(UI_PORT) MAILDEV_UI_PORT=$(MAILDEV_UI_PORT) ENV=$(ENV)

CM_COMMENTS_TARBALL ?= .h2a/build/cm-comments-candidate/sentropic-cluster-mesh-0.19.0.tgz
CM_COMMENTS_REPORT ?= .h2a/build/comments-installed
.PHONY: cluster-mesh-comments-installed
cluster-mesh-comments-installed: cluster-mesh-pg-up
	@test -f "$(CM_COMMENTS_TARBALL)"
	@mkdir -p "$(CM_COMMENTS_REPORT)"
	@docker run --rm --init --network "$(CM_PG_NAME)" -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/comments-npm-cache \
		-e CM_PG_URL="postgresql://postgres:qualification-only@$(CM_PG_NAME):5432/storage_test" \
		-v "$(abspath $(CM_COMMENTS_TARBALL)):/candidate.tgz:ro" -v "$(abspath $(CM_COMMENTS_REPORT)):/reports" \
		-v "$(CURDIR)/packages/cluster-mesh/tests/storage:/probe:ro" $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; \
		mkdir -p /tmp/comments-bare /tmp/comments-consumer; cp /probe/installed-bare.mjs /tmp/comments-bare/; cd /tmp/comments-bare; \
		npm install --omit=optional --ignore-scripts --no-audit --no-fund /candidate.tgz >/dev/null; node installed-bare.mjs > /reports/bare.json; \
		cd /tmp/comments-consumer; cp /probe/installed-*.mjs .; \
		npm install --omit=optional --ignore-scripts --no-audit --no-fund --save-exact /candidate.tgz @sentropic/comments@0.3.0 >/dev/null; \
		npm install --save-dev --ignore-scripts --no-audit --no-fund --save-exact pg@8.16.3 >/dev/null; \
		cp node_modules/@sentropic/cluster-mesh/assets/storage/comments/oracle/conformance.mjs installed-oracle.mjs; \
		npm ls --all --omit=dev --json > /reports/production-tree.json; cp package-lock.json /reports/consumer-package-lock.json; \
		npm audit --omit=dev --audit-level=high --json > /reports/audit.json; node installed-qualify.mjs'

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

CM_PG_NEXT_IMAGE := postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
.PHONY: cluster-mesh-pg-major-phase cluster-mesh-pg-major-upgrade
cluster-mesh-pg-major-phase:
	@docker run --rm --init --network "$(CM_PG_NAME)" -u "$$(id -u):$$(id -g)" -e HOME=/tmp \
		-e CM_MAJOR_PHASE="$(CM_MAJOR_PHASE)" -e CM_PG_URL="postgresql://postgres:qualification-only@$(CM_PG_NAME):5432/storage_test" \
		-e CM_PG_UPGRADE_URL="postgresql://postgres:qualification-only@$(CM_PG_NAME)-next:5432/storage_test" \
		-e CM_PG_REFERENCE_URL="postgresql://postgres:qualification-only@$(CM_PG_NAME)-next:5432/reference_test" \
		-v "$(abspath $(CM_COMMENTS_TARBALL)):/candidate.tgz:ro" -v "$(abspath $(CM_COMMENTS_REPORT)):/reports" \
		-v "$(CURDIR)/packages/cluster-mesh/tests/storage:/probe:ro" $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; \
		mkdir /tmp/cm-major; cd /tmp/cm-major; cp /probe/installed-major-upgrade.mjs .; \
		npm_config_cache=/tmp/npm-cache npm install --omit=optional --ignore-scripts --no-audit --no-fund /candidate.tgz pg@8.16.3 >/dev/null; \
		node installed-major-upgrade.mjs'

cluster-mesh-pg-major-upgrade: cluster-mesh-pg-up
	@test -f "$(CM_COMMENTS_TARBALL)"
	@mkdir -p "$(CM_COMMENTS_REPORT)"
	@set -eu; next="$(CM_PG_NAME)-next"; \
		docker run -d --name "$$next" --network "$(CM_PG_NAME)" --label sentropic.storage-test="$(ENV)" \
		  -e POSTGRES_PASSWORD=qualification-only -e POSTGRES_DB=storage_test "$(CM_PG_NEXT_IMAGE)" >/dev/null; \
		trap 'docker rm -fv "'"$$next"'" >/dev/null' EXIT; \
		attempt=0; until docker exec "$$next" pg_isready -h 127.0.0.1 -U postgres -d storage_test >/dev/null; do \
		  attempt=$$((attempt+1)); [ "$$attempt" -lt 30 ] || exit 1; sleep 1; done; \
		docker exec "$$next" createdb -U postgres reference_test; \
		$(MAKE) -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk cluster-mesh-pg-major-phase CM_MAJOR_PHASE=seed ENV=$(ENV); \
		docker exec "$(CM_PG_NAME)" pg_dump -U postgres --no-owner --no-privileges storage_test | \
		  docker exec -i "$$next" psql -U postgres -d storage_test --set ON_ERROR_STOP=on >/dev/null; \
		$(MAKE) -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk cluster-mesh-pg-major-phase CM_MAJOR_PHASE=verify ENV=$(ENV)
