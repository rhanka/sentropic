# Supplemental delivery diagnostics; these do not replace P01-P10 or receipt.mjs.
R5_PRODUCER_DIR ?= /home/antoinefa/src/graphify-wt-mcpl4
R5_TARBALL ?= /home/antoinefa/src/sentropic/.tmp/memory-l5-r5/sentropic-engram-0.22.0.tgz
.PHONY: memory-l5-r5-diagnostics
memory-l5-r5-diagnostics: memory-l5-runtime
	@test "$(ENV)" = test-memory-l5
	@mkdir -p tmp/memory-l5-r5
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e MCP_L4_NPM_BIN=/usr/local/bin/npm -v "$(CURDIR):/workspace" -v "$(R5_PRODUCER_DIR):/producer:ro" -v "$(R5_TARBALL):/candidate.tgz:ro" -w /workspace $(MEMORY_L5_NODE_IMAGE) node tools/memory-mcp-l5/r5-diagnostics.mjs
