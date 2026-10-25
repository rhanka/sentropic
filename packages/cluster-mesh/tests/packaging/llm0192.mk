include Makefile

.PHONY: qualify-llm0192
qualify-llm0192: build-cluster-mesh
	@docker run --rm -v "$(CURDIR):/source:ro" -w /fixture $(LLM_MESH_NODE_IMAGE) \
		sh -ec 'npm install --no-save --no-audit --no-fund --ignore-scripts @sentropic/llm-mesh@0.19.2 >/dev/null; cp /source/packages/cluster-mesh/tests/packaging/llm0192.mjs /fixture/probe.mjs; node /fixture/probe.mjs'
