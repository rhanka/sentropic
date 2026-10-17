# seat-tools: owner-machine helper entrypoints (CISEAT-EX3).
# Only reviewed Make entrypoints may run bounded local readers natively.
# No host test campaign, server, refresher, or whole-home/keyring export.

seat-helper-setup:
	node --version
	test -f ../dist/node/cli-seat-store-reader.js || (echo "build @sentropic/llm-mesh first" && exit 1)

seat-inspect:
	test -n "$(CLI)" || (echo "usage: make seat-inspect CLI=<agy|codex|vibe|muse|claude> [SEAT_PROFILE_LABEL=<label>] ENV=dev-ci-seat-import" && exit 2)
	SEAT_CLI="$(CLI)" SEAT_PROFILE_LABEL="$(SEAT_PROFILE_LABEL)" node ./inspect.mjs
