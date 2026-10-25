# L1 verification receipt

Author: codex / gpt-6.1-sol / high. Scope: deterministic contract and packaging evidence, no runtime voice acceptance. Input/head/owner/gate references are in [baseline.md](baseline.md); independent-review selection is in [review.md](review.md).

## Test-first evidence

- Commit `7051d45e6` contains speech expectations before source implementation: scoped run failed on missing `speech/contracts.js`.
- After implementation: scoped green, **23 tests**. Full mesh regression: **47 files / 847 tests passed**.
- Source typecheck and isolated strict compilation of `tests/speech-contract.test.ts` passed; this includes the transcript union/type assertions.
- Lint passed for changed mesh source and the speech test with the repository's pinned ESLint 10.0.2 / typescript-eslint 8.56.1 rule set.
- Build/pack passed: six speech JS/declaration artifacts present, clean temporary consumer imports both public entrypoints, identical runtime exports, declaration consumption and immutable-final type rejection.
- A temporary copy of root/workspace manifests and the lock passes `npm ci --dry-run --ignore-scripts`, without writing dependencies into the mounted checkout.
- Cluster module regression: **5 files / 73 tests passed**, including 0.28 admission and 0.29 refusal; sibling provider packages compile in the cold workspace.
- Cluster integration regression: **5 files / 54 tests passed**, including mesh/gateway namespace identity and singleton topology.

## Reproduction

Run from this worktree. Every Docker step uses the shared lock, one ENV Compose project, existing `qualification` service and disposable `--rm` containers. Release the lock and clean the stack between steps:

```sh
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1/verify.mk test-llm-mesh SCOPE=tests/speech-contract.test.ts ENV=test-live-stt-l1
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1/verify.mk down ENV=test-live-stt-l1
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1/verify.mk test-llm-mesh ENV=test-live-stt-l1
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1/verify.mk down ENV=test-live-stt-l1
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1/verify.mk typecheck-llm-mesh ENV=test-live-stt-l1
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1/verify.mk down ENV=test-live-stt-l1
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1/verify.mk lint-llm-mesh ENV=test-live-stt-l1
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1/verify.mk down ENV=test-live-stt-l1
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1/verify.mk build-llm-mesh ENV=test-live-stt-l1
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1/verify.mk down ENV=test-live-stt-l1
rtk make -f .tmp/live-stt/l1/verify.mk -o build-harness scope-check ENV=test-live-stt-l1
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make test-cluster-mesh CM_RUN="docker compose -p test-live-stt-l1 -f docker-compose.immo-861.yml run --rm --no-deps -T" CM_RUN_IMAGE=qualification SCOPE=tests/modules ENV=test-live-stt-l1
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1/verify.mk down ENV=test-live-stt-l1
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make test-cluster-mesh CM_RUN="docker compose -p test-live-stt-l1 -f docker-compose.immo-861.yml run --rm --no-deps -T" CM_RUN_IMAGE=qualification SCOPE=tests/integrations ENV=test-live-stt-l1
rtk flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f .tmp/live-stt/l1/verify.mk down ENV=test-live-stt-l1
```

The committed adapter rebinds existing targets to Compose and the installed host harness. It does not edit Makefile/compose/CI or add a provider/build dependency. `-o build-harness` avoids the inherited raw-Docker prerequisite. Test/type/lint tools install with scripts disabled in container `/tmp`. The pinned qualification image is the existing Node 24 Debian image, digest `0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`. No host node_modules or interpreter process is created. This does not qualify any native speech engine/toolchain.

## Directly blocking integration correction

BRLIVE-L1-EX1 in BRANCH.md records the reason, paths, impact and rollback before editing compatibility metadata. The 0.28 minor exposed cluster's peer/module `<0.28.0` rejection (ERESOLVE and a red topology test), then gateway's `^0.27.0` requirement would create a second 0.27.1 mesh. Root lock refresh was inspected in disposable storage only; no broad lock rewrite or unrelated dependency update was applied.

Cluster's peer and module range now admit 0.28 and still refuse 0.29; gateway accepts its old minor or 0.28. Versions prepare mesh **0.28.0**, cluster **0.22.2**, gateway **0.21.1**, above registry observations 0.27.1 / 0.22.1 / 0.21.0. Exact exported namespaces/installed versions are checked by the cluster module/integration tests. No cluster speech schema/projection, gateway accounting or runtime behavior was added.

The contract exposes five engine placements, both mic modes, independent stages, exact model/adapter revisions, configuration revision and consent/target epochs. Unknown capabilities stay unqualified; all current text models retain their prior output declarations. The coordinator still owns transcript reconciliation, durable fences/effect outcomes, playback clamping and queue limits. No provider catalogue entry or binary artifact is admitted by these fixtures.

## Remaining acceptance

Mechanical branch/scope checks pass. Whitespace, selective staging, commit sizes (each below 150 changed lines) and absence of attribution trailers were checked before handoff. ENV cleanup completed after each Docker step; no ports, host dependencies or other ENV resources were created.

[Draft PR #754](https://github.com/rhanka/sentropic/pull/754) opened with BRANCH.md as body. Initial CI run `40246816381` was observed in progress at `0e4a0d33e0d71ad9c401b78261d50c6d216c3210`; no CI success is claimed. Subsequent handoff edits are documentation only; final exact-head CI metadata is reported separately.

Paid/native/device/provider/latency/accounting campaigns, capacity reservations, independent review, package publication, consumer-lock adoption and deployment remain open under L0's named owners. $0 paid speech spend and zero campaign units reserved by this task. G-PUBLISH needs immutable protected-CI releases and clean installed consumer tuples; this local packed check does not close it. PR CI is a separate exact-head observation, reported at draft handoff.
