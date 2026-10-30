# Opt-in experiments only. Caller must hold the shared Docker flock.
SECQUAL_DIR := $(CURDIR)/tmp/security-qualify
SECQUAL_NODE := node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
SECQUAL_SCANNER := aquasec/trivy@sha256:2e6c00d711ab4ae41d8a30c2c1fd3bd3b62704c177bb120f95012e939edfb3df
export SECQUAL_COHORT ?= main-40832206894
SECQUAL_RUN = docker run --rm --read-only --cap-drop=ALL --security-opt=no-new-privileges --pids-limit=128 --memory=512m --cpus=1 --tmpfs /tmp:rw,nosuid,nodev,noexec,size=128m -u "$$(id -u):$$(id -g)" -v "$(CURDIR):/workspace:ro" -v "$(SECQUAL_DIR):/evidence" -w /workspace

.PHONY: security-qualify-window
security-qualify-window:
	@test "$$(date -u +%F)" \< '2026-11-13' || { echo 'coverage-blocked: SECQUAL-EX1 expired' >&2; exit 1; }

security-qualify-measure security-qualify-acquire security-qualify-image security-qualify-signature security-qualify-targets security-qualify-failures security-qualify-receipts security-qualify-current-receipts security-qualify-cosign-help security-qualify-scanner: security-qualify-window

.PHONY: security-qualify-measure
security-qualify-measure: ## Measure actual OCI data bytes without admitting the toolchain
	@mkdir -p "$(SECQUAL_DIR)" && chmod 700 "$(SECQUAL_DIR)"
	@$(SECQUAL_RUN) $(SECQUAL_NODE) node scripts/security/daily/qualify-acquisition.mjs $(KIND)

.PHONY: security-qualify-acquire
security-qualify-acquire: ## Exercise production ingestion and hash-checked warm restoration
	@mkdir -p "$(SECQUAL_DIR)" && chmod 700 "$(SECQUAL_DIR)"
	@$(SECQUAL_RUN) $(SECQUAL_NODE) node scripts/security/daily/qualify-cache.mjs

.PHONY: security-qualify-image
security-qualify-image: ## Inventory the frozen scanner and verifier before candidate execution
	@bash scripts/security/daily/qualify-image.sh
	@$(SECQUAL_RUN) --network=none $(SECQUAL_NODE) node scripts/security/daily/qualify-buildinfo.mjs > "$(SECQUAL_DIR)/native-inventory.jsonl"

.PHONY: security-qualify-signature
security-qualify-signature: ## Verify retained exact-index Sigstore material with networking disabled
	@bash scripts/security/daily/qualify-signature.sh
	@$(SECQUAL_RUN) --network=none $(SECQUAL_NODE) node scripts/security/daily/qualify-trust-receipt.mjs

.PHONY: security-qualify-targets
security-qualify-targets: ## Join trusted main-CI archives to immutable registry identities
	@bash scripts/security/daily/qualify-targets.sh

.PHONY: security-qualify-scans
security-qualify-scans: ## Run cold/warm all-severity archive experiments with no network or daemon mount
	@bash scripts/security/daily/qualify-scans.sh

.PHONY: security-qualify-failures
security-qualify-failures: ## Exercise real cache bytes and actual TCP faults in a disconnected container
	@$(SECQUAL_RUN) --network=none -v "$(SECQUAL_EXPIRED_METADATA):/expired-metadata.json:ro" $(SECQUAL_NODE) node scripts/security/daily/qualify-failures.mjs

.PHONY: security-qualify-ancillary
security-qualify-ancillary: ## Scan scanner/verifier dependencies and exercise frozen external IaC data offline
	@bash scripts/security/daily/qualify-ancillary.sh

.PHONY: security-qualify-java
security-qualify-java: ## Detect a real vulnerable Java archive using the frozen offline data
	@bash scripts/security/daily/qualify-java.sh

.PHONY: security-qualify-config
security-qualify-config: security-qualify-scanner
	@$(SECQUAL_RUN) --network=none $(SECQUAL_NODE) node scripts/security/daily/qualify-config-receipt.mjs check
	@bash scripts/security/daily/qualify-config.sh
	@$(SECQUAL_RUN) --network=none $(SECQUAL_NODE) node scripts/security/daily/qualify-config-receipt.mjs

.PHONY: security-qualify-config-receipts
security-qualify-config-receipts: security-qualify-window
	@$(SECQUAL_RUN) --network=none -v "$(CURDIR)/docs/security:/receipts" $(SECQUAL_NODE) node scripts/security/daily/qualify-config-receipt.mjs publish

.PHONY: security-qualify-scanner
security-qualify-scanner:
	@docker image inspect "$(SECQUAL_SCANNER)" >/dev/null 2>&1 || docker pull --platform linux/amd64 "$(SECQUAL_SCANNER)"
security-qualify-scans security-qualify-ancillary security-qualify-java: security-qualify-scanner

.PHONY: security-qualify-remote
security-qualify-remote: security-qualify-scanner
	@bash scripts/security/daily/qualify-remote.sh

.PHONY: security-qualify-verifier-candidate
security-qualify-verifier-candidate: security-qualify-scanner
	@bash scripts/security/daily/qualify-verifier-candidate.sh
	@$(SECQUAL_RUN) --network=none $(SECQUAL_NODE) node scripts/security/daily/qualify-buildinfo.mjs cosign-latest > "$(SECQUAL_DIR)/verifier-latest-inventory.jsonl"

.PHONY: security-qualify-receipts
security-qualify-receipts: ## Publish only the fixed allowlist of public qualification evidence
	@mkdir -p docs/security/sec-s2b-qualify
	@$(SECQUAL_RUN) --network=none -v "$(CURDIR)/docs/security/sec-s2b-qualify:/receipts" $(SECQUAL_NODE) node scripts/security/daily/qualify-publish.mjs

.PHONY: security-qualify-current-receipts
security-qualify-current-receipts:
	@$(SECQUAL_RUN) --network=none -v "$(CURDIR)/docs/security/sec-s2b-qualify:/receipts" $(SECQUAL_NODE) node scripts/security/daily/qualify-current.mjs

.PHONY: security-qualify-cosign-help
security-qualify-cosign-help:
	@$(SECQUAL_RUN) --network=none $(SECQUAL_NODE) /evidence/cosign verify-blob-attestation --help > "$(SECQUAL_DIR)/cosign-help.txt"
