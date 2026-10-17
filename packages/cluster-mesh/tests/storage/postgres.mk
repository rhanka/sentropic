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
