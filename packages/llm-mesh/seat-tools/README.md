# seat-tools — owner-machine seat helpers (inspect only)

Bounded, read-only format inspection for the owner's own lab seat
records. This helper never refreshes, mints, activates, transfers, or
calls any provider. It prints allowlisted categories only.

## Prerequisites

- Build `@sentropic/llm-mesh` first (`../dist/` must exist).
- Node version must match the pin in `node-runtime.json`
  (currently `v24.22.0`); the Makefile refuses any other runtime.

## Usage

```sh
make seat-helper-setup ENV=dev-ci-seat-import
make seat-inspect CLI=agy SEAT_PROFILE_LABEL=<lab-label> ENV=dev-ci-seat-import
```

`CLI` is one of `agy|codex|vibe|muse|claude`. `SEAT_PROFILE_LABEL`
selects the lab record; there are no default paths and no home
probing. Direct node use:

```sh
SEAT_CLI=agy SEAT_PROFILE_LABEL=<lab-label> node ./inspect.mjs
```

## Trust notes

- Only reviewed Make entrypoints may run bounded local readers
  natively. No host test campaign, server, refresher, or
  whole-home/keyring export.
- Owner backends plug into `inspectSeatStoreRecord` per the pinned
  P-AGY/P-CODEX/P-VIBE/P-MUSE/P-CLAUDE qualification results;
  without a registered backend the reader returns `unverified`.
- An explicit sidecar file can be read instead via
  `SeatSidecarFileBackend` in
  `../src/node/seat-sidecar-file-backend.ts`: one owner-provided
  path, ≤4096 bytes, categories only, never credential material.
