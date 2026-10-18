W0_NODE_IMAGE := node@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
W0_RECORD_DIR := $(CURDIR)/docs/baselines/app-cm-w0
W0_OUTPUT_DIR := $(CURDIR)/tmp/app-cm-w0-probe
W0_PROBE_PACKAGES := @sentropic/cluster-mesh@0.19.1 @sentropic/artifacts@0.1.1 @sentropic/mcp-platform@0.3.0 @sentropic/mcp-auth@0.2.2 @sentropic/auth-hono@0.16.0 @sentropic/llm-gateway@0.21.0 @sentropic/llm-mesh@0.27.0 @sentropic/comments@0.3.0 @modelcontextprotocol/sdk@1.32.1 hono@4.13.0 jose@5.10.0 @sentropic/h2a@0.98.6

.PHONY: w0-probe-env w0-host-fit w0-record-check
w0-probe-env:
	@case "$(ENV)" in test-*|e2e-*) ;; *) echo 'Use a dedicated test-* or e2e-* environment'; exit 1;; esac
	@mkdir -p "$(W0_OUTPUT_DIR)"

w0-host-fit: w0-probe-env
	@docker run --rm --user "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(W0_RECORD_DIR)/host-fit-probe.mjs:/probe.mjs:ro" -v "$(W0_OUTPUT_DIR):/out" -w /tmp $(W0_NODE_IMAGE) sh -ec 'probe_dir=$$(mktemp -d); cd "$$probe_dir"; npm install --ignore-scripts --no-audit --no-fund --save-exact $(W0_PROBE_PACKAGES) > /out/install.log 2>&1; cp /probe.mjs ./probe.mjs; node probe.mjs > /out/probe-result.json; cp package-lock.json /out/probe-package-lock.json'

w0-record-check: w0-probe-env
	@docker run --rm --user "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/source:ro" -v "$(W0_RECORD_DIR)/verify-vectors.mjs:/validate.mjs:ro" -v "$(W0_OUTPUT_DIR):/out" -w /tmp $(W0_NODE_IMAGE) sh -ec 'probe_dir=$$(mktemp -d); cd "$$probe_dir"; npm install --ignore-scripts --no-audit --no-fund --save-exact @sentropic/h2a@0.98.6 > /out/validate-install.log 2>&1; cp /validate.mjs ./validate.mjs; node validate.mjs'
