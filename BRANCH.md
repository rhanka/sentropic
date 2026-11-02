# Feature: Verifier and tool-content qualification (A04)

## Objective
- [x] Implement admission-plan-r1 section 5 row A04 (R3 tool-content qualification) under approved amendment r6 sections 3.3/3.4: independently inventory the selected Cosign verifier, the Sigstore TUF root bootstrap and the required acquisition/SBOM/uploader tools in `scripts/security/scanner/`, with exact-binary provenance, fresh independent self-SCA, dependency/zero-Python binding and candidate-bound tool admission before trusted signing/verification use. Contract-only; no live run, admission, promotion or workflow change.

## Scope / Guardrails
- [x] Binding r6 SHA-256: `4438d481e5021b06299d7c61bc95354dcd45d42664e59fdbecf02a2b0cfd451f`.
- [x] Binding plan SHA-256: `528dd39308a6e2cf8bdf31307c82da373cf3ceb666cb865a0417abfa7ece49d2`, section 5 row A04.
- [x] Worktree: `tmp/worktrees/cyber-admission-a04`; branch: `feat/cyber-admission-a04`; base: origin/main `a2776b2e0` (A01 = PR #883, A02 = PR #884, A03 = PR #885 merged).
- [x] Make-only Docker-first; single shared Docker lock `.tmp/packets/DOCKER-LOCK.md` taken per command (`flock <lock> make ...`); reuse the pinned Node image `node:24-bookworm-slim@sha256:0e0ff40c...`; no new image build.
- [x] `ENV=test-cyber-adm` last; no listening services or ports; no registry login, OIDC, secrets, live promotion or merge; `make down ENV=test-cyber-adm` after.
- [x] Keep the downstream verifier adapter (A05), trust state (A06), artifact transport (A07), publisher workflow (A08), production admission, policy changes (`.security/**`) and Track writes out of scope; the conductor remains the sole Track writer.
- [x] Tests first; selective staging; `make commit` under 150 changed lines; push after every commit; never suppress CI; never `[skip ci]`.
- [x] Stop on an unresolved design decision. The uploader is native ORAS per r4 (incorporated by r6); its exact digest is an A08 reviewed-workflow input, never a floating download, so the inventory records it as an explicit pending pin and admission refuses while pending. No digest is invented.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/node/keyring/encrypted-file-keyring.ts`
  - `packages/llm-mesh/src/node/index.ts`
  - `packages/llm-mesh/src/global.d.ts` (ambient `node:fs/promises` shim: add `stat`/`Stats`, the package compiles with `types: []`)
  - `packages/llm-mesh/tests/node/encrypted-file-keyring.test.ts`
  - `packages/llm-mesh/tests/decision-public-surface.test.ts`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/CHANGELOG.md`
  - `package-lock.json`
  - `packages/cluster-mesh/tests/fixtures/train.ts` (train pin rebind, required by the cluster-mesh validate lanes)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (selected tuple pin rebind)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (regenerated via `make -f packages/cluster-mesh/packaging.mk refresh-lazy-package-lock`)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `.github/workflows/**`
  - `scripts/ci/**`
  - `docs/**` (dated evidence inputs are read and digest-bound, never edited)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] Retain inherited BRLOCK-EX1 under `.security/ci-lockfile-policy.json`: owner=CI maintainers, review_by=2026-11-30T00:00:00Z; bounded scope and removal trigger remain unchanged, and catalog SCA debt stays open.
- [x] A01 merged as PR #883 (`e3fa8fab7`), A02 as PR #884 (`d1f45c625`), A03 as PR #885 (`a2776b2e0`); this branch is cut from origin/main `a2776b2e0`.
- [x] Dated public evidence is input only: `docs/security/sec-s2b-qualify/verifier-candidate.json` (Cosign 3.1.4 candidate, 253 Go deps, go1.27.3, zero HIGH/CRITICAL self-SCA), `docs/security/sec5a-trust-custody.json` (TUF root bootstrap, refreshBy 2026-11-06T01:22:45Z), `docs/security/sec-s2b-qualify/self-scans.json` (old Cosign 3.0.2 vulnerable report: 2 CRITICAL, 60 HIGH). Their October DB snapshots are stale for admission; freshness is enforced by the contract, not assumed.
- [x] Real scanner/tool outputs remain candidate data: admission receipts return `productionAdmitted: false` and never write a policy pin, receipt file or admission flag.

## AI Flaky tests
- [x] Deterministic contract tests; no AI flaky exception.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: single A04 lane with one ready PR against main; no merge.

## UAT Management (in orchestration context)
- [x] No UI surface; the pinned Node test lane provides the applicable gate.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules, approved r6/plan (both digests verified), A01-A03 contracts and the dated tool evidence.
  - [x] Create isolated worktree `tmp/worktrees/cyber-admission-a04` from origin/main `a2776b2e0`; harness branch check PASS C1.
  - [x] Locate the existing pinned Node test lane (`make test-security-daily`) and the shared Docker lock; production admission stays off.
- [x] **Lot 1 — Tests before implementation (RED)**
  - [x] `tool-inventory.test.mjs` + `tool-admission.test.mjs` (collected by `scanner-provenance.test.mjs`): real `tool-inventory.json` validates and cross-binds to the policy verifierCandidate, the material-manifest acquisition/sbom tool pins and the trust-custody TUF role digests; evidence digests bind actual docs bytes. RED gate: 289 pass / 1 fail (missing module), log `.tmp/rv/cyber-admission-a04-red.log`.
  - [x] Inventory mutation negatives: prose/non-hex pins, changed size/version, missing/extra role, origin outside the allowlists, verifier pin != policy, cacert/syft pin != manifest, uploader destination change, pending uploader blocks admission.
  - [x] Self-SCA negatives: wrong-binary report, vulnerable tool (HIGH/CRITICAL), stale/future DB freshness, dropped severity class, self-scan (scanner == tool), scan predating DB download; real old Cosign 3.0.2 report refused.
  - [x] Dependency-inventory negatives: omitted embedded module, extra module, version change, count mismatch; zero-Python negatives: python present, missing/mismatched evidence.
  - [x] Candidate-bound admission: complete synthetic tuple produces `ToolAdmissionReceiptV1` with `productionAdmitted: false`; pending pin/missing/rejected review, expired root bootstrap and rehashed inputs refuse.
- [x] **Lot 2 — Implementation**
  - [x] `tool-inventory.json`: five roles (verifier Cosign 3.1.4, root-bootstrap Sigstore TUF, acquisition cacert.pem, sbom syft 1.55.0, uploader ORAS pending the A08 reviewed pin) with exact digests/sizes/origins and digest-bound evidence references.
  - [x] `tool-qualification.mjs`: `validateToolInventory`, `validateToolSelfSca`, `validateToolDependencies`, `validateZeroPython`; `tool-admission.mjs`: `admitToolCandidate`, `validateAdmissionReceipt`.
  - [x] `tool-fixture.mjs`: synthetic complete tuple for contract tests.
  - [x] Wired `import '../scanner/tool-inventory.test.mjs'` and `import '../scanner/tool-admission.test.mjs'` into `scripts/security/daily/scanner-provenance.test.mjs`.
- [ ] **Lot 3 — Gates, ready PR and report**
  - [x] `flock .tmp/packets/DOCKER-LOCK.md make test-security-daily ENV=test-cyber-adm`: GREEN, 333 tests / 333 pass / 0 fail, EXIT=0; log `.tmp/rv/cyber-admission-a04-green.log`.
  - [x] `flock ... make down ENV=test-cyber-adm` after the gate (DOWN_EXIT=0, log `.tmp/rv/cyber-admission-a04-down.log`); no new image built; `make scope-check` PASS C2 (log `.tmp/rv/cyber-admission-a04-scope-check.log`); `harness check branch` PASS C1.
  - [ ] Atomic `make commit` under 150 lines each; pushed after every commit; no `[skip ci]`.
  - [ ] Open ready (non-draft) PR against main; pull_request CI fires on the final head.
  - [ ] Record exact heads, PR, CI and every test gate in `.tmp/rv/cyber-admission-a04.md` for conductor Track import.
  - [ ] Stop after A04; leave A05+ and all live admission/activation work fenced. Do not merge.
