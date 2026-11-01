# This file is promoted as data; credential-bearing execution uses /opt/seat-control.
SEAT_NODE := node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
.PHONY: test-ci-seat-contract
test-ci-seat-contract:
	@case "$(ENV)" in test-*|e2e-*) ;; *) echo 'ERROR: isolated test ENV required'; exit 1 ;; esac
	@docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
		-u "$$(id -u):$$(id -g)" --tmpfs /tmp:rw,nosuid,nodev \
		-v "$(CURDIR):/workspace:ro" -w /workspace/scripts/ci/seat-custody \
		$(SEAT_NODE) sh -ec 'if [ -n "$(SCOPE)" ]; then node --test $(SCOPE); else node --test tests/*.test.ts; fi'
