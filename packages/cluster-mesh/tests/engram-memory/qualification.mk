# Run from the worktree root with both Makefiles; reuse the pinned Compose images.
MEMORY_QUALIFICATION_MK := packages/cluster-mesh/tests/engram-memory/qualification.mk
MEMORY_RECEIPTS ?= tmp/memory-stage-b
MEMORY_SCOPE ?= tests/engram-memory/durable-memory.spec.ts
.PHONY: memory-stage-b memory-stage-b-locked
memory-stage-b:
	@test -n "$(filter test-e2-int test-mem-batch1,$(ENV))"
	@flock "$(E2_LOCK)" $(MAKE) -f Makefile -f $(MEMORY_QUALIFICATION_MK) memory-stage-b-locked ENV=$(ENV)

# Internal entry: caller holds the machine-wide lock through cleanup.
memory-stage-b-locked:
	@test -n "$(filter test-e2-int test-mem-batch1,$(ENV))"
	@test -z "$$(git status --porcelain)" || { echo 'Memory receipt requires a clean committed tree'; exit 1; }
	@printf '%s  %s\n' 1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730 tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json | sha256sum -c -
	@grep -Fxq 1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730 tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json.sha256
	@mkdir -p "$(MEMORY_RECEIPTS)"
	@set -euo pipefail; head="$$(git rev-parse HEAD)"; \
	  trap 'status=$$?; trap - EXIT; set +e; $(MAKE) down ENV=$(ENV) >> "$(MEMORY_RECEIPTS)/campaign.log" 2>&1; cleanup=$$?; \
	    printf "exit=%s\ncleanup=%s\n" "$$status" "$$cleanup" > "$(MEMORY_RECEIPTS)/campaign.status"; \
	    sha256sum "$(MEMORY_RECEIPTS)/campaign.log" "$(MEMORY_RECEIPTS)/campaign.status" > "$(MEMORY_RECEIPTS)/campaign.sha256"; \
	    test "$$status" -eq 0 && test "$$cleanup" -eq 0' EXIT; \
	  { date -u +%FT%TZ; printf 'head=%s\ntree=%s\n' "$$head" "$$(git rev-parse HEAD^{tree})"; git status --short; \
	    sha256sum $(MEMORY_QUALIFICATION_MK) packages/cluster-mesh/tests/engram-memory/memory-* packages/cluster-mesh/tests/engram-memory/durable-memory.spec.ts; \
	    sha256sum packages/cluster-mesh/assets/storage/postgres/engram-memory/002-host-ledger.sql tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json; \
	    $(MAKE) engram-e2-postgres-up API_PORT=$(API_PORT) UI_PORT=$(UI_PORT) MAILDEV_UI_PORT=$(MAILDEV_UI_PORT) ENV=$(ENV); \
	    $(MAKE) test-cluster-mesh SCOPE="$(MEMORY_SCOPE)" \
	      CM_PG_URL=postgresql://app:app@postgres:5432/app API_PORT=$(API_PORT) UI_PORT=$(UI_PORT) MAILDEV_UI_PORT=$(MAILDEV_UI_PORT) ENV=$(ENV); \
	  } 2>&1 | tee "$(MEMORY_RECEIPTS)/campaign.log"; \
	  test "$$head" = "$$(git rev-parse HEAD)" && test -z "$$(git status --porcelain)"; \
	  if grep -Fq '"status":"blocked"' "$(MEMORY_RECEIPTS)/campaign.log"; then \
	    echo 'Stage B qualification blocked: see MEMORY_STAGE_B_DISPOSITION' | tee -a "$(MEMORY_RECEIPTS)/campaign.log"; exit 2; \
	  fi
