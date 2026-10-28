W0_COMPOSE := docker compose --env-file /dev/null -p $(ENV) -f docker-compose.immo-861.yml
W0_HOST_PROBE ?= host-fit-probe.mjs
W0_RECORD_DIR := $(CURDIR)/docs/baselines/app-cm-w0
W0_OUTPUT_DIR := $(CURDIR)/tmp/app-cm-w0-probe
W0_SOURCE_SHA := 9ed96eb83cd77da710f1adeb83a19e425d6c4910
W0_CURRENT_SOURCE_SHA = $(shell jq -r .sourceSha $(W0_RECORD_DIR)/published-tuple.json)
W0_PROBE_PACKAGES := @sentropic/cluster-mesh@0.19.1 @sentropic/artifacts@0.1.1 @sentropic/mcp-platform@0.3.0 @sentropic/mcp-auth@0.2.2 @sentropic/auth-hono@0.16.0 @sentropic/llm-gateway@0.21.0 @sentropic/llm-mesh@0.27.0 @sentropic/comments@0.3.0 @modelcontextprotocol/sdk@1.32.1 hono@4.13.0 jose@5.10.0 @sentropic/h2a@0.98.6

.PHONY: w0-probe-env w0-host-fit w0-record-check
w0-probe-env:
	@case "$(ENV)" in test-*|e2e-*) ;; *) echo 'Use a dedicated test-* or e2e-* environment'; exit 1;; esac
	@mkdir -p "$(W0_OUTPUT_DIR)"

w0-host-fit: w0-probe-env
	@$(W0_COMPOSE) run --rm --no-deps --user "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(W0_RECORD_DIR)/$(W0_HOST_PROBE):/probe.mjs:ro" -v "$(W0_OUTPUT_DIR):/out" -w /tmp qualification sh -ec 'probe_dir=$$(mktemp -d); cd "$$probe_dir"; npm install --strict-peer-deps --ignore-scripts --no-audit --no-fund --save-exact $(W0_PROBE_PACKAGES) > /out/install.log 2>&1; cp /probe.mjs ./probe.mjs; node probe.mjs > /out/probe-result.json; cp package-lock.json /out/probe-package-lock.json'

w0-record-check: w0-probe-env
	@mkdir -p "$(W0_OUTPUT_DIR)/baseline-source"
	@git archive $(W0_SOURCE_SHA) package-lock.json api/package-lock.json api/package.json deploy/k8s | tar -x -C "$(W0_OUTPUT_DIR)/baseline-source"
	@mkdir -p "$(W0_OUTPUT_DIR)/tuple-source"
	@git archive $(W0_CURRENT_SOURCE_SHA) $$(jq -r '.sourceInputs | keys[]' "$(W0_RECORD_DIR)/published-tuple.json") | tar -x -C "$(W0_OUTPUT_DIR)/tuple-source"
	@$(W0_COMPOSE) run --rm --no-deps --user "$$(id -u):$$(id -g)" -e HOME=/tmp -e W0_SOURCE_SHA=$(W0_SOURCE_SHA) -e W0_CURRENT_SOURCE_SHA=$(W0_CURRENT_SOURCE_SHA) -v "$(CURDIR):/source:ro" -v "$(W0_OUTPUT_DIR)/baseline-source:/baseline-source:ro" -v "$(W0_OUTPUT_DIR)/tuple-source:/tuple-source:ro" -v "$(W0_RECORD_DIR)/verify-vectors.mjs:/validate.mjs:ro" -v "$(W0_OUTPUT_DIR):/out" -w /tmp qualification sh -ec 'probe_dir=$$(mktemp -d); cd "$$probe_dir"; npm install --ignore-scripts --no-audit --no-fund --save-exact @sentropic/h2a@0.98.6 > /out/validate-install.log 2>&1; cp /validate.mjs ./validate.mjs; node validate.mjs'

.PHONY: down
down:
	@$(W0_COMPOSE) down --volumes --remove-orphans
