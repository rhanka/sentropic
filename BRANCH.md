# feat(cluster-mesh): A4 gap lot G1 — OAuth tenant read surface (P4, design a4-cm-gaps-r2 §6/§10.2)

## Objective
Add the P4 OAuth tenant read surface to `@sentropic/cluster-mesh` per design `.tmp/cm-identity-agents/a4-cm-gaps-r2.md` (sha256 283cab23…, §6 P4, §10.2 lot G1): sibling read interfaces `OAuthConsentReadStoreV1` / `ServiceClientReadStoreV1` over the frozen `OAuthTenantStore`, the `OAuthTenantStoreV1` composition with typed accessors `oauthTenantStoreV1(tx)` / `oauthTenantStoreV1FromStores(stores)`, implementations in the PostgreSQL/SQLite tenancy stores and the in-memory doubles, the `1.2.0` composition descriptor row `oauth_tenant_reads`, and both-profile acceptance tests. No frozen 1.0 surface is edited; no table, schema asset or stored row changes.

## Scope / Guardrails
- Scope limited to the lot G1 path list below (design §10.2), branched from `origin/main` (A2.0b merged as 812d1f053, cluster-mesh 0.26.0-dev.6) per the stacking rules.
- Make-only workflow, one Docker build at a time under the flock in `.tmp/packets/DOCKER-LOCK.md`, taken per command; `ENV=test-a4-stack-g1` always last; `make down-volumes ENV=test-a4-stack-g1` after every test stack.
- Tests first: `packages/cluster-mesh/tests/identity/oauth-reads.spec.ts` written before the implementation, SQLite always + PostgreSQL under `CM_PG_URL` (a20b harness, zero skips on the qualified lane).
- Branch development in isolated worktree `tmp/worktrees/a4-gap-G1`, branch `feat/cm-a4-gaps-g1-oauth-reads`.
- Commits via `make commit MSG="..."` only, atomic, <=150 lines, `make scope-check` before every commit, selective `git add` of named files only.
- All new text in English. No secrets. No `[skip ci]`.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.
- Design pins: a4-cm-gaps-r2 sha256 283cab237a4a2630c9a545e312399469af307adcca0b95feec7cdbf016e2058b; owner answers 2026-10-30 (Q-K=A, Q-WS1=delete conversations, Q-IDP1=case-by-case deletion) — none alters lot G1.
- Version: after the rebase onto `origin/main` 353f08a8b, bump cluster-mesh to `0.26.0-dev.9` (dev.8 is taken by #895 seats, which merges first; published npm version is 0.25.0), with lockfile and packaging-fixture sync under BR-G1-EX1 and the memory-l5 P1 manifest regen under BR-G1-EX2.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/identity-contracts/oauth-reads.ts`
  - `packages/cluster-mesh/src/identity-contracts/composition-descriptors.ts`
  - `packages/cluster-mesh/src/identity-contracts/doubles.ts`
  - `packages/cluster-mesh/src/identity-contracts/index.ts`
  - `packages/cluster-mesh/src/identity-stores/tenancy-postgres.ts`
  - `packages/cluster-mesh/src/identity-stores/tenancy-sqlite.ts`
  - `packages/cluster-mesh/tests/identity/oauth-reads.spec.ts`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json` (BR-G1-EX1)
  - `api/package-lock.json` (BR-G1-EX1)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (BR-G1-EX1)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (BR-G1-EX1)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `.github/workflows/**`
  - `api/**` (except `api/package-lock.json` under BR-G1-EX1)
  - `ui/**`, `e2e/**`, `deploy/**`, `scripts/**`, and every other tools path outside the BR-G1-EX2 conditional path above
  - `packages/cluster-mesh/src/**` outside the allowed list above
  - `packages/cluster-mesh/tests/**` outside `tests/identity/oauth-reads.spec.ts`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `tools/memory-mcp-l5/artifacts/**` (BR-G1-EX2 only: P1 manifest + lock-snapshots regen through make)
- **Exception process**:
  - `BR-G1-EX1` (declared here, in `## Feedback Loop`): version-bump lockfile sync. The `enforce-package-bump` CI job and the packaging lock-integrity suites require the workspace version bump to be mirrored in the root `package-lock.json`, `api/package-lock.json` and the `tests/packaging/fixtures/selected` consumer fixture (tgz filename). Reason: keep lock metadata consistent with `packages/cluster-mesh/package.json` 0.26.0-dev.9. Impact: mechanical version-string edits only, same file set as the merged A2.0b bump 45e961c8e. Rollback: revert the bump commit.

## Feedback Loop
- `BR-G1-EX1`: lockfile + packaging-fixture sync for the 0.26.0-dev.9 bump (see exception above); mirrors merged precedent 45e961c8e.
  - `BR-G1-EX2` (declared here, in `## Feedback Loop`): memory-l5 P1 manifest regen. Every rebase that touches the root lock must regenerate `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json` (+ `.sha256` + new `lock-snapshots/<sha>.package-lock.json` + `<sha>.json` + `<sha>.json.sha256`) through `make memory-l5-pack STAGE=pre-candidate`, as #893 did (615043ead, 5b27adc8a under BR01-EX5). Reason: the P1 manifest pins the sha256 of the committed root `package-lock.json`; pack.mjs refuses to run when the working-tree lock differs from HEAD. Impact: manifest metadata + one new lock-snapshot file set only. Rollback: revert the regen commit.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single CM lot on its own branch; no sub-workstreams)
- Rationale: lot G1 is one bounded CM contract + stores + tests; no parallel sub-branches needed.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, design a4-cm-gaps-r2 §3/§6/§10.0/§10.2, owner answers 2026-10-30.
  - [x] Worktree `tmp/worktrees/a4-gap-G1` on `feat/cm-a4-gaps-g1-oauth-reads` from `origin/main` 88078a995; `harness check branch` PASS.
  - [x] Environment mapping: tests on `ENV=test-a4-stack-g1` only, never root dev; PostgreSQL qualification container `cm-storage-test-a4-G1` via `postgres.mk`.
  - [x] Command style: `flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md make ... ENV=test-a4-stack-g1` (ENV last, one lock per make command); `make down-volumes ENV=test-a4-stack-g1` after.
- [ ] **Lot 1 — Tests first: `tests/identity/oauth-reads.spec.ts`**
  - [x] Spec written per design §6.4: grant/find/revoke/re-grant semantics inside one write attempt + rollback absence; `findServiceClientBinding` multi-tenant/rebind; accessor refusals (`identity_contract_unavailable` on a store without the methods, `identity_transaction_unbound` on expired/foreign handles); doubles coverage in the same file.
  - [x] Post-rebase: memory-l5 P1 manifest regenerated via `make memory-l5-pack STAGE=pre-candidate` (BR-G1-EX2; previous manifest retained in `artifacts/history/bf0bac2f….json`, new lock snapshot `df43ebd0….package-lock.json`).
- [x] Lot gate (SQLite): `flock <lock> make test-cluster-mesh SCOPE=tests/identity/oauth-reads.spec.ts ENV=test-a4-stack-g1` green 5/5 (2.89s), then `make down-volumes ENV=test-a4-stack-g1` exit 0.
- [ ] **Lot 2 — Contract: `oauth-reads.ts` + descriptor + index export**
  - [ ] `src/identity-contracts/oauth-reads.ts` (read interfaces, `OAuthTenantStoreV1`, `IdentityStoresOauthV1`, `oauthTenantStoreV1`, `oauthTenantStoreV1FromStores`).
  - [ ] `src/identity-contracts/composition-descriptors.ts` created with `IDENTITY_COMPOSITION_CONTRACT_VERSION = '1.2.0'` and the `oauth_tenant_reads` row.
  - [ ] One additive export line per new file in `src/identity-contracts/index.ts`.
- [ ] **Lot 3 — Store implementations**
  - [ ] `tenancy-postgres.ts` + `tenancy-sqlite.ts`: `findConsent`, `findConsentForGrant` (newest live, bytewise tie-break via `COLLATE "C"` on PG / BINARY default on SQLite), `listConsentsForUser`, `findServiceClientBinding`; `oauth` field widened to `OAuthTenantStoreV1`.
  - [ ] `doubles.ts`: same four methods on `InMemoryOAuthTenantStore`.
- [ ] **Lot 4 — Gates**
  - [ ] `make typecheck-cluster-mesh`, `make build-cluster-mesh`, `make lint-cluster-mesh` under the per-command flock.
  - [ ] New spec on SQLite, then PostgreSQL leg: `cluster-mesh-pg-up` + scoped `cluster-mesh-workspace CM_ACTION=test` with `CM_PG_URL` on the `cm-storage-test-a4-G1` network, then `cluster-mesh-pg-down`.
  - [ ] Frozen suites unmodified and green: `tests/identity-membership.spec.ts`, `tests/identity-a22-scenarios.ts` (via `identity-a22-sqlite.spec.ts` / `identity-a22-postgres.spec.ts`), plus packaging specs.
  - [ ] `make down-volumes ENV=test-a4-stack-g1` after every stack; no image removal.
- [ ] **Lot 5 — Version bump, push, PR**
  - [x] Rebased onto `origin/main` 353f08a8b (sole conflict: BRANCH.md, resolved to this file + the BRLOCK-EX1 review_by line); bumped to 0.26.0-dev.9 with BR-G1-EX1 lockfile/fixture sync; `npm view @sentropic/cluster-mesh version` = 0.25.0 < 0.26.0-dev.9 (post-rebase gate).
  - [ ] Push branch (crash safety), open READY PR with this BRANCH.md as body, run one CI, record result in `.tmp/rv/a4-gap-G1.md`. Do not merge.
