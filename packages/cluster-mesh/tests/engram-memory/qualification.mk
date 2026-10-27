# Run from the worktree root with both Makefiles; reuse the pinned Compose images.
MEMORY_QUALIFICATION_MK := packages/cluster-mesh/tests/engram-memory/qualification.mk
MEMORY_RECEIPTS ?= tmp/memory-stage-b
MEMORY_SCOPE ?= tests/engram-memory/durable-memory.spec.ts
.PHONY: memory-stage-b memory-stage-b-locked
memory-stage-b:
	@test "$(ENV)" = test-e2-int
	@flock "$(E2_LOCK)" $(MAKE) -f Makefile -f $(MEMORY_QUALIFICATION_MK) memory-stage-b-locked ENV=$(ENV)

# Internal entry: caller holds the machine-wide lock through cleanup.
memory-stage-b-locked:
	@test "$(ENV)" = test-e2-int
	@git diff --exit-code ee654ace2 -- tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json.sha256
	@mkdir -p "$(MEMORY_RECEIPTS)"
	@set -euo pipefail; \
	  trap 'status=$$?; trap - EXIT; set +e; $(MAKE) down ENV=$(ENV) >> "$(MEMORY_RECEIPTS)/campaign.log" 2>&1; cleanup=$$?; \
	    printf "exit=%s\ncleanup=%s\n" "$$status" "$$cleanup" > "$(MEMORY_RECEIPTS)/campaign.status"; \
	    sha256sum "$(MEMORY_RECEIPTS)/campaign.log" "$(MEMORY_RECEIPTS)/campaign.status" > "$(MEMORY_RECEIPTS)/campaign.sha256"; \
	    test "$$status" -eq 0 && test "$$cleanup" -eq 0' EXIT; \
	  { date -u +%FT%TZ; git rev-parse HEAD; git status --short; \
	    sha256sum $(MEMORY_QUALIFICATION_MK) packages/cluster-mesh/tests/engram-memory/memory-* packages/cluster-mesh/tests/engram-memory/durable-memory.spec.ts; \
	    sha256sum packages/cluster-mesh/assets/storage/postgres/engram-memory/002-host-ledger.sql tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json; \
	    $(MAKE) engram-e2-postgres-up API_PORT=9045 UI_PORT=5245 MAILDEV_UI_PORT=1145 ENV=$(ENV); \
	    $(MAKE) test-cluster-mesh SCOPE="$(MEMORY_SCOPE)" \
	      CM_PG_URL=postgresql://app:app@postgres:5432/app API_PORT=9045 UI_PORT=5245 MAILDEV_UI_PORT=1145 ENV=$(ENV); \
	  } 2>&1 | tee "$(MEMORY_RECEIPTS)/campaign.log"
