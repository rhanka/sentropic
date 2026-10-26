# L1c deterministic verification receipt

Author: codex / gpt-6.1-sol / high. Inputs, heads and §11.2 owners are in
[baseline.md](baseline.md). Target source is unchanged since `5c679c80e`;
`eb898c7d4c76db88a7e4649a44c6f23127211fa3` includes final package documentation.
Later records do not certify native engines or live cancellation.

## Tests first and observed results

- `55a5c9b00` records configuration expectations before source implementation.
  Red: missing `speech/config.js`; `ac7134bfd` adds projection expectations and
  the second red run fails both suites on that missing module.
- Scoped green: **48 tests / 2 files**. Five primary tuples, whisper.cpp, future
  providers and native duplex, all placements/mic modes, malformed/secret fields,
  empty/explicit fallback, capability/selector/media refusal, offline projection,
  tenant/policy/egress refusal, immutable snapshots and safe revision/consent rebind.
- Cold quality gate passes source build, existing type fixtures, strict compilation
  of both speech suites, changed-source/test lint and public packed-content checks.
  It verifies all six speech JS/declaration files, matching root/subpath decoder
  exports, isolated projection export and unchanged capacity-only behavior.
- Full default cluster suite: **137 files / 1,162 tests passed; 56 files /
  129 tests skipped** by existing environment gates. Speech's 48 tests pass here
  after the root declaration correction. Database/crash/installed-fixture tests
  requiring separate environments are not inferred passed from this run.
- Dedicated packed-consumer matrix: running separately; result recorded below.
- Registry `npm view` before the bump: cluster 0.22.1, mesh 0.27.1, gateway 0.21.0.
  Source train is cluster 0.23.0 / mesh 0.28.0 / gateway 0.21.1; no publication.

## Reproduce

From `tmp/worktrees/live-stt-l1c`, one command at a time. After every Docker step,
release the lock and run the cleanup command before another step:

```sh
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1c/verify.mk test-cluster-mesh SCOPE=tests/speech- ENV=test-live-stt-l1c
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1c/verify.mk down ENV=test-live-stt-l1c
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1c/verify.mk lint-cluster-mesh ENV=test-live-stt-l1c
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1c/verify.mk down ENV=test-live-stt-l1c
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1c/verify.mk test-cluster-mesh ENV=test-live-stt-l1c
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1c/verify.mk down ENV=test-live-stt-l1c
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1c/verify.mk test-cluster-mesh L1C_PACKED=1 ENV=test-live-stt-l1c
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1c/verify.mk down ENV=test-live-stt-l1c
rtk make -f .tmp/live-stt/l1c/verify.mk -o build-harness scope-check ENV=test-live-stt-l1c
```

The adapter reuses the existing cold-workspace and packed-tuple bootstrap in
the existing qualification service, with ENV-owned disposable containers/network,
no published ports and no host dependencies. Qualification image is pinned Node
24 Debian slim digest `0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`.
Tool installation happens only in container scratch space, with scripts disabled
for the quality bootstrap. This is no G-NATIVE engine installation receipt.

## Remaining release and runtime gates

[review.md](review.md) records independent-review selection failure without
inference. The Q4 study has zero admitted units/reservations and $0 speech spend.
Native/toolchain/license/device/controller/cloud/accounting/placement campaigns,
capacity admission, CI/OIDC publication, exact h2a adoption and deployment retain
their separate L0 owners/gates. Configuration and synthetic evidence do not grant
credentials, select a live agent, activate a microphone or qualify engine latency.

Mechanical scope/branch checks, whitespace, selective staging, commit line counts
and absence of attribution trailers are checked at handoff. Draft PR and exact-head
CI metadata are observations reported separately, without a blanket success claim.
