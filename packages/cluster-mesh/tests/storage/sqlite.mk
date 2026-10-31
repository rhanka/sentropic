# SQLite L3a qualification targets (lot 1) plus the SQL-L1 memory connection
# profile and Stage-0 extension gate. Source tooling delegates to the root
# Makefile's disposable workspace; no pg container is required. Docker lanes
# serialize under the common packet flock.
SQLITE_DOCKER_LOCK ?= /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md

.PHONY: cluster-mesh-sqlite-test
cluster-mesh-sqlite-test:
	@$(MAKE) -f Makefile -f packages/cluster-mesh/tests/storage/sqlite.mk cluster-mesh-sqlite-run SCOPE="$(if $(SCOPE),$(SCOPE),tests/storage/sqlite-)" ENV=$(ENV)

.PHONY: cluster-mesh-sqlite-run
cluster-mesh-sqlite-run:
	@case "$(ENV)" in test-*|e2e-*) ;; *) echo 'SQLite qualification requires test-* or e2e-*'; exit 1;; esac
	@flock "$(SQLITE_DOCKER_LOCK)" $(MAKE) cluster-mesh-workspace CM_ACTION=test SCOPE="$(SCOPE)" ENV=$(ENV)

# SQL-L1 Stage-0 gate: the verified sqlite-vec load runs through the
# extension gate on the qualified container image. The pinned tool graph is
# committed under sqlite-l1/vec-tool and resolved with `npm ci`, so the lane
# never performs unlocked registry resolution; the runner refuses loudly when
# any capability is missing, so the receipt has zero skipped cases.
.PHONY: cluster-mesh-sqlite-s0-qualify
cluster-mesh-sqlite-s0-qualify:
	@case "$(ENV)" in test-*|e2e-*) ;; *) echo 'SQLite S0 qualification requires test-* or e2e-*'; exit 1;; esac
	@flock "$(SQLITE_DOCKER_LOCK)" docker run --rm -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
	  -v "$(CURDIR):/workspace:ro" -w /workspace/packages/cluster-mesh \
	  $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; \
	  cp tests/storage/sqlite-l1/vec-tool/package.json tests/storage/sqlite-l1/vec-tool/package-lock.json "$$tool_dir/"; \
	  npm ci --prefix "$$tool_dir" --ignore-scripts --no-audit --no-fund >/dev/null; \
	  NODE_PATH="$$tool_dir/node_modules" node tests/storage/sqlite-l1/s0-qualify.mjs'
