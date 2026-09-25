# Feature: cluster-mesh 0.13.0 train package — Lot D B3d

## Objective
- [x] Deliver the cluster-mesh 0.13.0 candidate of the Lot D release train (mesh 0.22.0 → gateway 0.19.0 → cluster 0.13.0) per `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md` §10 (B3d), §12.1, §12.4, §12.6 and the approved release-train design v3 (package part only).

## Scope / Guardrails
- [x] Branch `feat/cluster-mesh-013`, worktree `tmp/cluster-mesh-013`, based on `feat/llm-gateway-budget` (mesh 0.22.0 + gateway 0.19.0 candidates).
- [x] Make-only checks; Docker-first; no Python; English text; `ENV=test-cluster-mesh-013` last; never `ENV=dev` or `clean-all`.
- [x] Ports reserved if a service starts: API `9464`, UI `5664`, Maildev UI `1564`.
- [x] Selective staging and separate `make commit`; update checkboxes in each atomic commit, approximately 150 lines maximum.
- [x] HARD STOP: no push, no PR, no merge, no publication (train only).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/**` (incl. `packaging.mk`, `tests/packaging/**`, fixtures, README, CHANGELOG)
  - `BRANCH.md`
  - `.github/workflows/ci.yml` (BRDP-EX10 only: train publish barrier, strict chain, concurrency, lock-sync, sibling-first lazy qualification, healed post-publication qualification, `verify-train-lock-integrity`)
  - `scripts/ci/publishable-ci-wiring.test.mjs` (BRDP-EX10 wiring assertions only)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**` other than the BRDP-EX10 `ci.yml` hunks
  - `.track/**`
  - `plan/**`
  - `deploy/**`
  - `packages/llm-mesh/**`, `packages/llm-gateway/**` (frozen candidates), other `packages/**`, `api/**`, `apps/**`
  - `packages/cluster-mesh/src/hono/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - root `package-lock.json` refresh through Make for the train versions (BRDP-EX6)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `attention`: BRDP-EX6 — root `package-lock.json` workspace entries move to mesh 0.22.0 / gateway 0.19.0 / cluster 0.13.0 (lock-sync assertion of the train); hand edit with the editing tool on the three `packages/<slug>` entries only (version and manifest ranges mirrored), content-equivalent to a Make refresh (mesh 0.22 has no deps, gateway 0.19 adds none), because `make lock-root` runs a full workspace install writing node_modules into the worktree; the train integration runs the sanctioned Make refresh and requires an empty diff (a non-empty diff is a repair, not a rebase artifact); rollback = revert the lockfile hunk with this lot.
- `attention`: B3a (mesh 0.22.0) and B3b (gateway 0.19.0) must never merge separately on main: their manifests were ahead of the root lock, which only this lot syncs; they land with the train.
- `attention`: follow-up — `createCliNamespaceModule` survives without a catalog entry after the `cli` id removal; retire it or document its carrier in a later lot (`src/hono/**` forbidden here).
- `attention`: pack-reproducibility residual (sibling bytes vs the bytes CI will publish) is netted by `check-train-lock-integrity` (registry `dist.tarball`/`dist.integrity` vs the committed lock) and the follow-up no-op lock diff.
- `attention`: conductor decision — the automatic leaf guard now enforces the accepted peer ranges (behavior change in 0.13.0, CHANGELOG); guard modules split per family (`topology-guard-llm-mesh`, `topology-guard-gateway`), `topology-guard` keeps identity only for `compose/disabled`.
- `attention`: `packages/llm-mesh/node_modules` was left root-owned by `make test-llm-mesh` (container runs as root) and blocked `install-internal-packages` (EACCES); renamed in place to the ignored `packages/llm-mesh/node_modules-root-residue.local` (no tracked change); removal needs root.
- `attention`: owner decision — gated module ids `focus`, `cli`, `build-cli` removed from `CLUSTER_MESH_GATED_MODULE_IDS`/`ClusterMeshModuleId` (public union change, CHANGELOG); the `/cli` transport namespace of `src/hono/cli-router.ts` is a separate `ClusterMeshNamespace` from `@sentropic/contracts` and stays untouched (`src/hono/**` forbidden).
- `attention`: npm 11.19 does not fail the plain old-tuple install with ERESOLVE: it exits 0 after "ERESOLVE overriding peer dependency" and drops both conflicting root requests (0.12's gateway-017 case failed with ERESOLVE); `--force` does the same. Outcome `refused` = old tuple not installed (exit code and installed versions recorded in `npm-install-detail`); the skewed tree for the runtime refusal is built with `--legacy-peer-deps`.
- `attention`: global consumer + separately installed runtime with `file:` siblings + `overrides` is green; a one-off experiment without `overrides` was also green (the runtime's direct `file:` sibling satisfies gateway's `^0.22.0` edge, registry never queried), so no placeholder fallback beyond `__LLM_MESH__`/`__LLM_GATEWAY__` substitution was needed.
- `attention`: registry mode (no `SIBLING_ARCHIVES_FILE`) fails at `selected` `npm ci` with 404 until mesh 0.22.0 / gateway 0.19.0 are published (fail-safe, expected by the train design); CI still needs EX10 (siblings before the lazy qualification) — ci.yml untouched here.
- `attention`: every sibling in a receipts file is validated by `scripts/ci/qualify-published-install.mjs` `loadSiblings` itself (guard receipt, path, sha256, head sha = `git rev-parse HEAD`, packed identity and manifest guard, no unlisted archive) plus a basename-collision refusal, before any use; an invalid receipt fails the run rather than falling back to the registry. Receipts must be re-packed after every commit (`pack-candidate-siblings` with `MANIFEST_CONTEXT_FILE`).
- `attention`: npm 11.19 partial bump (consumer keeps its own `^0.21.2`/`^0.18.0` pins) exits 1 with ERESOLVE; the skewed tree is built with `--legacy-peer-deps` and refused at every leaf, loader, compose entry and preflight.
- `attention`: BRDP-EX10 (conductor-approved, design v3 points a-f) — reason: one green train PR, no registry write before the three train validations pass, no cluster-mesh 0.13.0 without its peers, no publish race, loud detection of pack drift; impact: `global` fires on the train PR (full CI), llm-mesh publication is coupled to cluster-mesh validation when the lock moves, cluster-mesh post-publication qualification also runs on a `skipped` receipt whose version is on the registry; rollback: revert the `ci.yml` EX10 commit and its wiring-test commit (no version or data impact).
- `attention`: root-owned `packages/llm-mesh/node_modules` recurred (EACCES in `install-internal-packages`); renamed to the ignored `packages/llm-mesh/node_modules-root-residue-2.local` (no tracked change); removal needs root.
- `attention`: BRDP-EX6 closed in the train — after the `origin/main` merge, `make lock-root` writes an empty `package-lock.json` diff.
- `attention`: train rule — llm-mesh 0.22.0, llm-gateway 0.19.0 and cluster-mesh 0.13.0 land on main in this single PR and publish in one main run (mesh → gateway → cluster); none of them merges or publishes separately.
- `attention`: merge freeze (owner-enforced) — the conductor announces an all-lanes merge freeze on main 1 h before the train merge; it is lifted only after the lock-refresh follow-up PR lands.
- `attention`: post-merge checklist — verify the 3 published manifests (provenance, gitHead = merge commit, peer ranges, dist.integrity); `make -f packages/cluster-mesh/packaging.mk check-train-lock-integrity ENV=<env>` green (and the `verify-train-lock-integrity` job); lock-refresh follow-up PR (`refresh-lazy-package-lock` without siblings) with an empty diff, else a traced pack-drift repair.
- `attention`: deviation from train design §5 (conductor-requested, fix round 1) — the three train publishers and `verify-train-lock-integrity` start with `!cancelled()` instead of `always()`, so a manual cancel stops the chain; the rest of each condition stays literal; rollback = restore `always()` and the wiring assertions.
- `attention`: `verify-train-lock-integrity` passes `REQUIRE_PUBLISHED` = packages whose publish job result is `success` in this run (retried 12 x 5 s, then red); cluster-mesh post-publication heal of a `skipped` receipt runs only when `GITHUB_RUN_ATTEMPT` > 1 (first attempt: notice, exit 0).

## AI Flaky tests
- [x] Not applicable: deterministic unit and packed-install tests, no provider call.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** (Lot D wave 3; train integration by the conductor)
- Rationale: B3d is a cluster-mesh-only lane cherry-picked into the conductor train branch.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read spec §10 (B3d), §12.1, §12.3, §12.4, §12.6 and train design v3.
  - [x] Verify branch, registry latest cluster-mesh `0.12.0` (target `0.13.0` free), mesh `0.21.2`, gateway `0.18.0`.
- [x] **Lot 1 — Manifest, catalog and module ids**
  - [x] `package.json` 0.13.0, peers mesh `>=0.22.0 <0.23.0`, gateway `>=0.19.0 <0.20.0`; `catalog.ts` ranges equal.
  - [x] Remove `focus`, `cli`, `build-cli` gated module ids; CHANGELOG.
  - [x] Unit tests and fake package trees moved to the new tuple; `{ '/gw': '/' }` remap case.
- [x] **Lot 2 — Packed qualification (train design §2b-d)**
  - [x] `packaging.mk` `SIBLING_ARCHIVES_FILE` (exact path) and `check-train-lock-integrity`.
  - [x] `prepare.sh` sibling resolver with sha256/identity check and registry fallback, `sources.txt`, provisional `selected` mode, lock with registry `resolved` and sibling integrity.
  - [x] Fixtures on 0.22.0/0.19.0/0.13.0; old-tuple (0.21.2/0.18.0) refusal at install and runtime; packed missing-jose refusal.
  - [x] Global consumer + separately installed runtime with `file:` + `overrides` proven.
- [x] **Lot 3 — Docs, lockfile and proof**
  - [x] README compatibility matrix and remap line; root lockfile (EX6).
  - [x] Export diff artifact 0.12.0 (published) vs 0.13.0 (packed): `exports`, 19 subpath `.d.ts`, `sideEffects`, `peerDependenciesMeta` identical; changes = mesh/gateway peer ranges, `focus`/`cli`/`build-cli` gated ids, internal catalog ranges.
  - [x] Gate: `make typecheck-cluster-mesh test-cluster-mesh build-cluster-mesh pack-cluster-mesh` PASS (48 files, 359 tests; guard PASS block), `lint-cluster-mesh` PASS, packed `test-lazy-package` with `SIBLING_ARCHIVES_FILE` PASS (5 files, 38 tests; lock integrity matches both siblings), `test-llm-mesh` PASS (32/270), `test-llm-gateway` PASS (27/273), `scope-check` PASS C2; registry mode fails at `selected` `npm ci` (404, unpublished tuple, expected).
  - [x] Round-0 candidates (superseded by Lot 4): cluster-mesh 0.13.0 sha256 `5e4b5bf3882a4c33bbb44efdeafffd3b82e3499b52bd758e9e9edaf12733ffa2`, llm-mesh 0.22.0 `91fce7217da6abb60b93d6af04db7a873df4a7826795f6893970f15c77810751`, llm-gateway 0.19.0 `0b8d0f5ca790b45472df76c8280ca628c64ccaa9c8f33387899e2493ca48db89` (equal to the B3b digest).
- [x] **Lot 4 — Review fix round 1 (muse + opus + conductor)**
  - [x] Automatic leaf guard enforces the accepted peer ranges per family (llm-mesh leaves: llm-mesh; gateway leaves, loaders and compose: llm-gateway and llm-mesh), memoized per copy set and family; `sideEffects` lists the two family guards.
  - [x] Unit trees: correct tuple, out-of-range refusal message, nested in-range and out-of-range copies, gateway-located llm-mesh, prerelease/build metadata, HMR re-evaluation.
  - [x] Sibling receipts validated by `loadSiblings` itself (head sha, packed-manifest guard, unlisted archives) plus basename collision; a cluster-mesh receipt is the qualified candidate.
  - [x] `refresh` errors on a sibling version mismatch; `registry` compares `resolved`; refusal rows for absolute path and non-array/unreadable receipts.
  - [x] Old-tuple and partial-bump fixtures record exit, warnings and installed versions; leaves, loaders and preflight refuse `incompatible_version`; every leaf imports in the correct single-tree and global topologies.
  - [x] README/CHANGELOG: automatic range guard, optional preflight, upgrading to 0.13.
  - [x] Gate: `make typecheck-cluster-mesh lint-cluster-mesh test-cluster-mesh build-cluster-mesh` PASS (50 files, 374 tests), `pack-cluster-mesh` PASS block, `pack-candidate-siblings` (2 receipts at HEAD), packed `test-lazy-package` with `SIBLING_ARCHIVES_FILE` PASS (7 files, 48 tests), `scope-check` PASS C2.
  - [x] Export diff re-verified: leaf/loader/compose `.d.ts` differ only by the guard import line, `dist/index.d.ts` identical, `sideEffects` +2 family guards, internal `topology` adds `ClusterMeshLeafFamily`/`assertClusterMeshTopology(family?)`.
  - [x] Candidates (not published): cluster-mesh 0.13.0 sha256 `8235173fafc28ac3a70d22f62555a3eea99edc02ea2bc75d18a16e7daf711a8e`, llm-mesh 0.22.0 `91fce7217da6abb60b93d6af04db7a873df4a7826795f6893970f15c77810751`, llm-gateway 0.19.0 `0b8d0f5ca790b45472df76c8280ca628c64ccaa9c8f33387899e2493ca48db89` (both unchanged).
- [x] **Lot 5 — Train integration (merge main, B3d minors, EX10, gates)**
  - [x] Merge `origin/main` (B1 `apps/llm-gateway`, cli/build-cli/focus eradication); `make lock-root` diff empty.
  - [x] B3d minor (a): `parseReleaseVersion` strips `+build` metadata (npm parity), prereleases still refused; unit rows, README, CHANGELOG.
  - [x] B3d minor (b): range check through a `tree.link()` symlinked workspace copy (in-range passes, out-of-range refused on the physical path).
  - [x] EX10 `ci.yml`: siblings packed before the lazy qualification (`SIBLING_ARCHIVES_FILE` when receipts exist), publish barrier and strict chain, `npm-publish-train` concurrency, `changes` lock-sync, healed post-publication qualification, `verify-train-lock-integrity`.
  - [x] EX10 wiring tests (`publishable-ci-wiring.test.mjs`): exact train publish conditions and needs, strict upstream waits, concurrency group, lock-sync step, integrity job never a dependency, sibling-first lazy qualification, healed skip qualification.
  - [x] Gate PASS: `typecheck/lint/test/build/pack` for llm-mesh (32/270), llm-gateway (27/273), cluster-mesh (50 files, 379 tests); `pack-candidate-siblings` (2 receipts); packed `test-lazy-package` with `SIBLING_ARCHIVES_FILE` (7 files, 48 tests); `test-publishable-manifests` (73); `check-ci-version-filters`; `check-eradicated-packages`; `typecheck-llm-gateway-process`, `test-llm-gateway-process` (4/44) and `typecheck-api` (with `REGISTRY=local`, worktree has no `.env`); `scope-check` PASS C2.
  - [x] Candidates (not published): cluster-mesh 0.13.0 sha256 `6d091489ea2d5e62bd0f0e7d30de00d5b3b9fcb4296379f4a139e0b49f10cc54` (vs round 1: internal `dist/modules/semver.*` and README only), llm-mesh 0.22.0 `91fce7217da6abb60b93d6af04db7a873df4a7826795f6893970f15c77810751`, llm-gateway 0.19.0 `0b8d0f5ca790b45472df76c8280ca628c64ccaa9c8f33387899e2493ca48db89` (unchanged).
- [x] **Lot 6 — Train fix round 1 (muse + opus, conductor-verified defect)**
  - [x] Packed release matrix expects `sibling` per package only when `siblings/index.json` carries that exact `name@version`, else `registry`; unit rows: no index, empty receipts, only mesh, only gateway, both, other version.
  - [x] `check-lock-integrity registry` requires the packages published in this run (`REQUIRE_PUBLISHED`): cache-bypassing lookups retried 12 x 5 s, then an error; others stay notice-only; unit rows on a local fake registry.
  - [x] EX10 `ci.yml`: skipped-receipt heal only on a re-run (`github.run_attempt > 1`), dead `qualify-report.json` test removed; `!cancelled()` replaces the leading `always()` of the three train publishers and `verify-train-lock-integrity`; wiring assertions.
  - [x] Gate PASS: `test-publishable-manifests` (73), `check-ci-version-filters`, `check-eradicated-packages`, `typecheck/lint/test/build/pack-cluster-mesh` (52 files, 389 tests; pack PASS block), `pack-candidate-siblings` (2 receipts at `c7909d843`), packed `test-lazy-package` with `SIBLING_ARCHIVES_FILE` (9 files, 58 tests), `scope-check` PASS C2; empty receipts `[]` at the exact path: accepted, all registry, fails at `selected` `npm ci` 404 (0.22.0 unpublished, expected; per-package expectation proven by unit rows).
  - [x] Candidates (not published, unchanged: only unpacked test files, `packaging.mk` and `ci.yml` moved): cluster-mesh 0.13.0 sha256 `6d091489ea2d5e62bd0f0e7d30de00d5b3b9fcb4296379f4a139e0b49f10cc54`, llm-mesh 0.22.0 `91fce7217da6abb60b93d6af04db7a873df4a7826795f6893970f15c77810751`, llm-gateway 0.19.0 `0b8d0f5ca790b45472df76c8280ca628c64ccaa9c8f33387899e2493ca48db89`.
