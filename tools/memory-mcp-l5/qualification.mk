# Post-P3 consumers only. Frozen pre-candidate producing recipes remain unchanged.
-include tools/memory-mcp-l5/r5-inputs.mk
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
memory-l5-qualify: memory-l5-execution-context
	@test -n "$(ARTIFACT_MANIFEST)" -a -n "$(CHECKPOINT)"
	@ENV="$(ENV)" sh tools/memory-mcp-l5/qualify.sh "$(ARTIFACT_MANIFEST)" "$(CHECKPOINT)"
.PHONY: memory-l5-execution-context
memory-l5-execution-context: memory-l5-proposal-runtime
	@docker run --rm -u "$$(id -u):$$(id -g)" -e ARTIFACT_MANIFEST="$(ARTIFACT_MANIFEST)" -e CHECKPOINT="$(CHECKPOINT)" -e MEMORY_L5_SOURCE_HEAD="$$(git rev-parse HEAD)" -e GITHUB_RUN_ID -e GITHUB_RUN_ATTEMPT -v "$(CURDIR):/workspace" -w /workspace $(MEMORY_L5_NODE_IMAGE) node tools/memory-mcp-l5/execution.mjs context
memory-l5-collect: memory-l5-proposal-runtime
	@docker run --rm -u "$$(id -u):$$(id -g)" -e ARTIFACT_MANIFEST="$(ARTIFACT_MANIFEST)" -e CHECKPOINT="$(CHECKPOINT)" -e MEMORY_L5_SOURCE_HEAD="$$(git rev-parse HEAD)" -e MEMORY_L5_BASE="$$(git merge-base origin/main HEAD)" -e GITHUB_RUN_ID -e GITHUB_RUN_ATTEMPT -v "$(CURDIR):/workspace" -w /workspace $(MEMORY_L5_NODE_IMAGE) node tools/memory-mcp-l5/collect.mjs

.PHONY: memory-l5-disabled-install
.PHONY: memory-l5-native-positive
memory-l5-native-positive: memory-l5-proposal-runtime
	@test -n "$(MEMORY_L5_REPORT)"
	@docker run --rm -e HOME=/tmp -e CONTROL_UID="$$(id -u)" -e CONTROL_GID="$$(id -g)" -e MEMORY_L5_REPORT="$(MEMORY_L5_REPORT)" -v "$(CURDIR):/workspace" -w /workspace $(MEMORY_L5_NODE_IMAGE) sh -lc 'set -eu; apt-get update -qq; apt-get install --no-install-recommends -y gcc libc6-dev >/dev/null; for binary in python python2 python3; do ! command -v "$$binary"; done; tool_dir="$$(mktemp -d)"; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.1.0 >/dev/null; mkdir -p tools/memory-mcp-l5/node_modules; trap '\''rm -rf tools/memory-mcp-l5/node_modules; test ! -f "$$MEMORY_L5_REPORT" || chown "$$CONTROL_UID:$$CONTROL_GID" "$$MEMORY_L5_REPORT"'\'' EXIT; ln -s "$$tool_dir/node_modules/vitest" tools/memory-mcp-l5/node_modules/vitest; "$$tool_dir/node_modules/.bin/vitest" run controls/native-compile.test.mjs --root tools/memory-mcp-l5 --environment node --reporter=json --outputFile="$$MEMORY_L5_REPORT"'
memory-l5-disabled-install: memory-l5-proposal-runtime
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e ARTIFACT_MANIFEST="$(ARTIFACT_MANIFEST)" -e NATIVE_OUTPUT="$(NATIVE_OUTPUT)" -v "$(CURDIR):/workspace" -w /workspace $(MEMORY_L5_NODE_IMAGE) node tools/memory-mcp-l5/disabled-install.mjs

# Network/lifecycle preparation runs before Vitest's per-case timer. The assertion
# consumes the fresh, digest-bound observation; it cannot reuse another tuple.
.PHONY: memory-l5-packed-disabled
memory-l5-packed-disabled: memory-l5-proposal-runtime
	@test -n "$(ARTIFACT_MANIFEST)" -a -n "$(NATIVE_OUTPUT)"
	@$(MAKE) memory-l5-disabled-install ARTIFACT_MANIFEST="$(ARTIFACT_MANIFEST)" NATIVE_OUTPUT="$(NATIVE_OUTPUT)" API_PORT=$(API_PORT) UI_PORT=$(UI_PORT) MAILDEV_UI_PORT=$(MAILDEV_UI_PORT) ENV=$(ENV)
	@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e ARTIFACT_MANIFEST="$(ARTIFACT_MANIFEST)" -e DISABLED_INSTALL_RESULT="/workspace/$(NATIVE_OUTPUT)/result.json" -e MEMORY_L5_REPORT="$(MEMORY_L5_REPORT)" -v "$(CURDIR):/workspace" -w /workspace $(MEMORY_L5_NODE_IMAGE) sh -lc 'set -eu; tool_dir="$$(mktemp -d)"; trap '\''rm -rf tools/memory-mcp-l5/node_modules'\'' EXIT; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund vitest@4.1.0 >/dev/null; mkdir -p tools/memory-mcp-l5/node_modules; ln -s "$$tool_dir/node_modules/vitest" tools/memory-mcp-l5/node_modules/vitest; sh tools/memory-mcp-l5/run-vitest.sh "$$tool_dir" /workspace "$$MEMORY_L5_REPORT" installed-candidate run packed/disabled-install.test.ts --environment node --root tools/memory-mcp-l5'
