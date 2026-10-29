# Post-P3 consumers only. Frozen pre-candidate producing recipes remain unchanged.
.PHONY: memory-l5-candidate memory-l5-checkpoint memory-l5-proposal-runtime
memory-l5-proposal-runtime: memory-l5-runtime
	@test "$(ENV)" = test-memory-l5 || { echo 'ENV=test-memory-l5 required' >&2; exit 1; }
memory-l5-candidate memory-l5-checkpoint: memory-l5-proposal-runtime

memory-l5-candidate:
	@test -n "$(CANDIDATE_INPUTS)" -a -n "$(ARTIFACT_MANIFEST)" || { echo 'CANDIDATE_INPUTS and ARTIFACT_MANIFEST required' >&2; exit 1; }
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace $(MEMORY_L5_NODE_IMAGE) node tools/memory-mcp-l5/candidate.mjs --inputs "$(CANDIDATE_INPUTS)" --head "$$(git rev-parse HEAD)" --manifest "$(ARTIFACT_MANIFEST)"

memory-l5-checkpoint:
	@test -n "$(CHECKPOINT_INPUTS)" -a -n "$(ARTIFACT_MANIFEST)" -a -n "$(CHECKPOINT)" || { echo 'CHECKPOINT_INPUTS, ARTIFACT_MANIFEST and CHECKPOINT required' >&2; exit 1; }
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace $(MEMORY_L5_NODE_IMAGE) node tools/memory-mcp-l5/checkpoint.mjs --inputs "$(CHECKPOINT_INPUTS)" --manifest "$(ARTIFACT_MANIFEST)" --checkpoint "$(CHECKPOINT)"

.PHONY: memory-l5-qualify memory-l5-collect
memory-l5-qualify: memory-l5-proposal-runtime
	@test -n "$(ARTIFACT_MANIFEST)" -a -n "$(CHECKPOINT)"
	@ENV="$(ENV)" sh tools/memory-mcp-l5/qualify.sh "$(ARTIFACT_MANIFEST)" "$(CHECKPOINT)"
memory-l5-collect: memory-l5-proposal-runtime
	@docker run --rm -u "$$(id -u):$$(id -g)" -e ARTIFACT_MANIFEST="$(ARTIFACT_MANIFEST)" -e CHECKPOINT="$(CHECKPOINT)" -e MEMORY_L5_SOURCE_HEAD="$$(git rev-parse HEAD)" -e MEMORY_L5_BASE="$$(git merge-base origin/main HEAD)" -e GITHUB_RUN_ID -e GITHUB_RUN_ATTEMPT -v "$(CURDIR):/workspace" -w /workspace $(MEMORY_L5_NODE_IMAGE) node tools/memory-mcp-l5/collect.mjs
