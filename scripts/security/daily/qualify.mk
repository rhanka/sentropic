# Opt-in experiments only. Caller must hold the shared Docker flock.
SECQUAL_DIR := $(CURDIR)/tmp/security-qualify
SECQUAL_NODE := node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
SECQUAL_RUN = docker run --rm --read-only --cap-drop=ALL --security-opt=no-new-privileges --pids-limit=128 --memory=512m --cpus=1 --tmpfs /tmp:rw,nosuid,nodev,noexec,size=128m -u "$$(id -u):$$(id -g)" -v "$(CURDIR):/workspace:ro" -v "$(SECQUAL_DIR):/evidence" -w /workspace

.PHONY: security-qualify-measure
security-qualify-measure: ## Measure actual OCI data bytes without admitting the toolchain
	@mkdir -p "$(SECQUAL_DIR)" && chmod 700 "$(SECQUAL_DIR)"
	@$(SECQUAL_RUN) $(SECQUAL_NODE) node scripts/security/daily/qualify-acquisition.mjs $(KIND)

.PHONY: security-qualify-acquire
security-qualify-acquire: ## Exercise production ingestion and hash-checked warm restoration
	@mkdir -p "$(SECQUAL_DIR)" && chmod 700 "$(SECQUAL_DIR)"
	@$(SECQUAL_RUN) $(SECQUAL_NODE) node scripts/security/daily/qualify-cache.mjs
