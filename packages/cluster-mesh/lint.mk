# Package-local lint entry point; run from the repository root with -f.
CLUSTER_MESH_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/../..)
LLM_MESH_NODE_IMAGE ?= node:24-bookworm-slim

.PHONY: lint-cluster-mesh
lint-cluster-mesh:
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CLUSTER_MESH_ROOT):/workspace" \
		-w /workspace/packages/cluster-mesh $(LLM_MESH_NODE_IMAGE) sh -lc 'set -eu; \
		tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" \
			--no-save --no-audit --no-fund eslint@10.0.2 typescript-eslint@8.56.1 >/dev/null; \
		printf "%s\n" "import tseslint from '\''typescript-eslint'\'';" \
			"export default tseslint.config(...tseslint.configs.recommended, { rules: { '\''@typescript-eslint/no-empty-object-type'\'': '\''off'\'', '\''@typescript-eslint/no-explicit-any'\'': '\''off'\'', '\''@typescript-eslint/no-unused-vars'\'': '\''off'\'' } });" \
			> "$$tool_dir/eslint.config.mjs"; \
		"$$tool_dir/node_modules/.bin/eslint" --config "$$tool_dir/eslint.config.mjs" src tests'
