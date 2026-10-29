R5_PRODUCER_DIR ?= /home/antoinefa/src/graphify-wt-mcpl4
R5_DELIVERY_DIR ?= /home/antoinefa/src/sentropic/.tmp/memory-l5-r5
R5_REGISTRY_DIR ?= /home/antoinefa/src/sentropic/tmp/worktrees/mem-l5-lot3/tmp/lot3-inputs
.PHONY: memory-l5-r5-inputs
memory-l5-r5-inputs: memory-l5-proposal-runtime
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -v "$(R5_PRODUCER_DIR):/producer:ro" -v "$(R5_DELIVERY_DIR):/delivery:ro" -v "$(R5_REGISTRY_DIR):/registry:ro" -w /workspace $(MEMORY_L5_NODE_IMAGE) node tools/memory-mcp-l5/r5-inputs.mjs
