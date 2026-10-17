# seat-tools: owner-machine helper entrypoints (CISEAT-EX3).
# Only reviewed Make entrypoints may run bounded local readers natively.
# No host test campaign, server, refresher, or whole-home/keyring export.

seat-helper-setup:
	node --version
	test -f ../dist/node/cli-seat-store-reader.js || (echo "build @sentropic/llm-mesh first" && exit 1)

seat-inspect:
	test -n "$(CLI)" || (echo "usage: make seat-inspect CLI=<agy|codex|vibe|muse|claude> [SEAT_PROFILE_LABEL=<label>] [SEAT_SIDECAR=<path>] ENV=dev-ci-seat-import" && exit 2)
	node -e "const m=require('./node-runtime.json'); if (process.version !== m.node) { console.error('node ' + process.version + ' does not match pinned ' + m.node); process.exit(1); }"
	SEAT_CLI="$(CLI)" SEAT_PROFILE_LABEL="$(SEAT_PROFILE_LABEL)" SEAT_SIDECAR="$(SEAT_SIDECAR)" node ./inspect.mjs
