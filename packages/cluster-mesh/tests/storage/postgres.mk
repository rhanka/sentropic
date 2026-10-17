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
