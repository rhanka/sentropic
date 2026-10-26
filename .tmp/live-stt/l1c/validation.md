# L1c deterministic verification receipt

## PR757 Opus r2 integration

- Main advanced during the first CI run: merge #769 at
  `365e8b313f1c4c627c87db4f6761847a1e6a5ae7` adds Memory L5 evidence/tests.
  The second integration resolves only `BRANCH.md`, retaining the L1c plan;
  cluster/mesh sources, manifests and root lock match `5258b9a6c` byte-for-byte.
  The locked speech rerun passes **4 files / 66 tests**, zero skips, with
  `SCOPE=tests/speech- ENV=test-stt-l1c`. All tests/qualifications passed in
  [the first CI run](https://github.com/rhanka/sentropic/actions/runs/40401909237)
  at `5258b9a6c`; CI is refreshed on the second merge head.
- Retargeted draft #757 from `feat/live-stt-l1` to `main`.
- Integrated `origin/main` at `ab981b16dfe4769d0dd44443f4d459a375848a8d`
  with a merge commit; no history rewrite.
- Kept cluster 0.23.0, the speech export and comments range <0.24.0;
  retained main's Decision support and selected comments 0.3.1 / gateway
  0.21.3 / mesh 0.28.1 tuple, changing only the cluster archive version.
- Registry check through the locked Compose make adapter: cluster 0.22.4,
  mesh 0.28.1, gateway 0.21.3; the cluster bump remains above publication.
- Mechanical scope check uses `SCOPE_BASE=origin/main` to exclude inherited
  upstream changes. Track containment preserves all 346 pre-merge event IDs.
- Integration commands use the owner's `ENV=test-stt-l1c`; the adapter also
  retains the historical ENV accepted by the reproduction commands below.
- Post-merge `make -f .tmp/live-stt/l1c/verify.mk test-cluster-mesh
  ENV=test-stt-l1c` through the shared Docker flock passes **142 files /
  1,208 tests**, including all **66 speech tests**. The **56 files / 129 tests**
  gated on separate environments remain skipped; packed qualification is a
  separate CI gate. This replaces the historical default-suite receipt for
  the integrated source tuple.

## PR757 Opus r1 corrections

Author: codex / gpt-6.1-sol / high. Corrected source/test target:
`e436bd0a6`; input verdict: `.h2a/reviews/pr757_opus_r1.md` at `a5ee9cfe4`.

- P1 red: three new single-stage assertions fail with `SpeechConfigurationError`.
  Green: chained accepts STT-only in both mic modes and TTS-only; duplex accepts
  independently selected companion stages. Empty bindings remain refused.
- P2-1 red: eight registry tests fail because speech is uncatalogued. Green:
  the speech entry loads through the registry with `>=0.28.0 <0.29.0`, checking
  version, exports and required members before evaluating the peer. Existing
  text compatibility stays unchanged; the packed skew probe includes speech.
- P2-2 red: digest is absent and modified bindings at `r1` project successfully.
  Green: canonical SHA-256 pins selection/projection/consent, and reload checks
  against retained revision history reject changed scoped revision content.
- Full default suite: **139 files / 1,180 tests passed**, including **66 speech
  tests**; **56 files / 129 tests skipped** behind their environment gates.
- Quality adapter: strict source/test types, lint, build and package-content
  checks; six native Node ESM import probes exercise old mesh versions without
  speech exports and 0.28 with absent, invalid and valid speech exports.
- Registry recheck: cluster 0.22.1, mesh 0.27.1, gateway 0.21.0. The existing
  unpublished cluster 0.23.0 bump remains above registry; no publication.
- LOW lane uses short scoped qualification steps with a one-second lock wait,
  releases the lock between steps and tears down only `test-live-stt-l1c`.
  The prior 100-test installed matrix below is historical, not rerun for r1;
  the updated import refusal is checked with six native ESM fixture trees.
- Commits use specific-file staging and `make commit`, with fewer than 150
  changed lines each. Review r2 is for the independent reviewer; no new
  reviewer session, consensus verdict or main-base CI success is inferred.

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
- Dedicated packed-consumer matrix: **15 files / 100 tests passed, zero skips**.
  The selected installed train is cluster 0.23.0 / mesh 0.28.0 / gateway 0.21.1;
  bare-root import/declarations stay free of optional peers, supported installed
  tuples compile/load, and deliberately skewed tuples remain refused. Sibling
  mesh/gateway archive SHA-256 values match the approved L1 bytes:
  `be07abbd916276f524ac148b71cf28a7310dbb10c9c2d5140d9cd1fa78dfc485` /
  `7d4f6e8f6e6c8543510f0bec3593b9238f4c1547b576dcafb9c965376b9df591`.
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

Draft [#757](https://github.com/rhanka/sentropic/pull/757) targets `feat/live-stt-l1`
and preserves L1's exact commits. Initial pushed head
`8958a090d0c35c207501ebad27361775653aac52` has **no PR workflow runs**: the existing
CI workflow filters pull requests to `main`. The integration owner must merge
#754, retarget #757 to main and obtain exact-head CI before merging L1c. This
draft neither changes that filter nor infers CI success from local checks.

Final audit at draft creation: 24 L1c commits, maximum **134 changed lines** per
commit; no attribution trailers, forbidden path changes or lost L1 ancestry.
All eight retained L0 files compare byte-identical with their frozen source ref.
Mechanical cumulative scope and branch checks pass; worktree is clean and the
ENV Compose network was removed. Later handoff-record commits repeat the audit.
