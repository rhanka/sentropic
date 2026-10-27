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

# E10 installed injection proof: clean consumer outside repository resolution.
INSTALLED_DIR ?= tmp/installed-memory-e10
INSTALLED_ENGRAM_TGZ ?= /home/antoinefa/src/graphify-wt-mcpl4/.graphify/scratch/l4-r4-artifacts/sentropic-engram-0.22.0.tgz
INSTALLED_MESH_VERSION ?= 0.24.0-dev.1
INSTALLED_RECEIPTS ?= $(INSTALLED_DIR)
.PHONY: installed-memory installed-memory-locked
installed-memory:
	@test -n "$(filter test-mem-e10 test-e2-int test-mem-batch1,$(ENV))"
	@flock "$(E2_LOCK)" $(MAKE) -f Makefile -f $(MEMORY_QUALIFICATION_MK) installed-memory-locked ENV=$(ENV)

# Internal entry: caller holds the machine-wide lock through cleanup.
installed-memory-locked:
	@test -n "$(filter test-mem-e10 test-e2-int test-mem-batch1,$(ENV))"
	@test -z "$$(git status --porcelain)" || { echo 'Installed receipt requires a clean committed tree'; exit 1; }
	@printf '%s  %s\n' 26a0edd50c338f30593d22ae1f06ac13d82f5557f18558750659bcfefec64c10 "$(INSTALLED_ENGRAM_TGZ)" | sha256sum -c -
	@printf '%s  %s\n' 1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730 tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json | sha256sum -c -
	@mkdir -p "$(INSTALLED_DIR)/artifacts" "$(INSTALLED_DIR)/consumer"
	@set -euo pipefail; head="$$(git rev-parse HEAD)"; \
	  trap 'status=$$?; trap - EXIT; set +e; $(MAKE) down ENV=$(ENV) >> "$(INSTALLED_RECEIPTS)/campaign.log" 2>&1; cleanup=$$?; \
	    printf "exit=%s\ncleanup=%s\n" "$$status" "$$cleanup" > "$(INSTALLED_RECEIPTS)/campaign.status"; \
	    sha256sum "$(INSTALLED_RECEIPTS)/campaign.log" "$(INSTALLED_RECEIPTS)/campaign.status" > "$(INSTALLED_RECEIPTS)/campaign.sha256"; \
	    test "$$status" -eq 0 && test "$$cleanup" -eq 0' EXIT; \
	  { date -u +%FT%TZ; printf 'head=%s\ntree=%s\n' "$$head" "$$(git rev-parse HEAD^{tree})"; \
	    cp "$(INSTALLED_ENGRAM_TGZ)" "$(INSTALLED_DIR)/artifacts/sentropic-engram-0.22.0.tgz"; \
	    cp tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json "$(INSTALLED_DIR)/artifacts/pre-candidate-manifest.json"; \
	    $(MAKE) build-cluster-mesh API_PORT=$(API_PORT) UI_PORT=$(UI_PORT) MAILDEV_UI_PORT=$(MAILDEV_UI_PORT) ENV=$(ENV); \
	    $(MAKE) engram-e2-postgres-up API_PORT=$(API_PORT) UI_PORT=$(UI_PORT) MAILDEV_UI_PORT=$(MAILDEV_UI_PORT) ENV=$(ENV); \
	    $(ARTIFACTS_COMPOSE) run --rm --no-deps -u "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
	      qualification sh -lc 'set -eu; rm -rf $(INSTALLED_DIR)/pack; mkdir -p $(INSTALLED_DIR)/pack; \
	        cp -R packages/cluster-mesh/dist packages/cluster-mesh/assets $(INSTALLED_DIR)/pack/; \
	        cp packages/cluster-mesh/package.json packages/cluster-mesh/README.md packages/cluster-mesh/LICENSE $(INSTALLED_DIR)/pack/; \
	        node -e "const fs=require(\"fs\");const p=\"$(INSTALLED_DIR)/pack/package.json\";const j=JSON.parse(fs.readFileSync(p,\"utf8\"));j.version=\"$(INSTALLED_MESH_VERSION)\";fs.writeFileSync(p,JSON.stringify(j,null,2)+\"\\n\")"; \
	        (cd $(INSTALLED_DIR)/pack && npm pack --pack-destination ../artifacts >/dev/null); \
	        cp packages/cluster-mesh/tests/engram-memory/installed-memory.mjs packages/cluster-mesh/tests/engram-memory/installed-memory-types.ts $(INSTALLED_DIR)/consumer/; \
	        printf "%s\n" "{\"name\":\"engram-e10-installed-consumer\",\"version\":\"1.0.0\",\"private\":true,\"type\":\"module\",\"dependencies\":{\"@sentropic/engram\":\"file:../artifacts/sentropic-engram-0.22.0.tgz\",\"@sentropic/cluster-mesh\":\"file:../artifacts/sentropic-cluster-mesh-$(INSTALLED_MESH_VERSION).tgz\",\"pg\":\"8.16.3\"},\"devDependencies\":{\"typescript\":\"5.4.5\",\"@types/node\":\"22.10.10\"}}" > $(INSTALLED_DIR)/consumer/package.json; \
	        cd $(INSTALLED_DIR)/consumer && npm install --package-lock-only --ignore-scripts --no-audit --no-fund \
	          && npm ci --ignore-scripts --no-audit --no-fund'; \
	    pg_image="$$($(ARTIFACTS_COMPOSE) ps -q postgres | xargs -r docker inspect --format '{{.Image}}' 2>/dev/null || echo postgres:17-alpine)"; \
	    $(ARTIFACTS_COMPOSE) run --rm --no-deps -u "$$(id -u):$$(id -g)" -e HOME=/tmp \
	      -v "$$(pwd)/$(INSTALLED_DIR)/consumer:/consumer" -w /consumer \
	      -e CM_PG_URL=postgresql://app:app@postgres:5432/app \
	      -e INSTALLED_CONSUMER_ROOT=/consumer -e INSTALLED_RECEIPT=/consumer/installed-receipt.json \
	      -e INSTALLED_ENGRAM_TGZ=/consumer/artifacts/sentropic-engram-0.22.0.tgz \
	      -e INSTALLED_MESH_TGZ=/consumer/artifacts/sentropic-cluster-mesh-$(INSTALLED_MESH_VERSION).tgz \
	      -e INSTALLED_P3_MANIFEST=/consumer/artifacts/pre-candidate-manifest.json \
	      -e INSTALLED_HEAD="$$head" -e INSTALLED_TREE="$$(git rev-parse HEAD^{tree})" -e INSTALLED_PG_IMAGE="$$pg_image" \
	      qualification sh -lc 'set -eu; mkdir -p /consumer/artifacts; \
	        cp /workspace/$(INSTALLED_DIR)/artifacts/pre-candidate-manifest.json /consumer/artifacts/; \
	        cp /workspace/$(INSTALLED_DIR)/artifacts/sentropic-engram-0.22.0.tgz /consumer/artifacts/; \
	        cp /workspace/$(INSTALLED_DIR)/artifacts/sentropic-cluster-mesh-$(INSTALLED_MESH_VERSION).tgz /consumer/artifacts/; \
	        ./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target es2022 --module nodenext --moduleResolution nodenext \
	          --listFiles installed-memory-types.ts > type-files.txt; \
	        node installed-memory.mjs; \
	        node -e "const fs=require(\"fs\");const receipt=JSON.parse(fs.readFileSync(\"/consumer/installed-receipt.json\",\"utf8\"));receipt.typeClosure=fs.readFileSync(\"/consumer/type-files.txt\",\"utf8\").split(\"\\n\").filter((line)=>line.includes(\"/node_modules/\")&&line.endsWith(\".d.ts\")).map((line)=>line.slice(\"/consumer/\".length)).sort();fs.writeFileSync(\"/consumer/installed-receipt.json\",JSON.stringify(receipt,null,2)+\"\\n\")"'; \
	    cp "$(INSTALLED_DIR)/consumer/installed-receipt.json" "$(INSTALLED_RECEIPTS)/installed-receipt.json"; \
	    sha256sum "$(INSTALLED_DIR)/artifacts/"*.tgz "$(INSTALLED_RECEIPTS)/installed-receipt.json"; \
	  } 2>&1 | tee "$(INSTALLED_RECEIPTS)/campaign.log"; \
	  test "$$head" = "$$(git rev-parse HEAD)"
