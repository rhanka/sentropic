# Feature: A4 gap lot G3 — P3 F13 service-principal tenancy (cluster-mesh)

## Objective
Build lot G3 of the binding design `.tmp/cm-identity-agents/a4-cm-gaps-r2.md` (sha256 `283cab237a4a2630c9a545e312399469af307adcca0b95feec7cdbf016e2058b`, last design round): piece P3 (design §7, lot row §10.4) — the CM-owned service-principal `tid` issuer (`createServicePrincipalTidIssuerV1`) with the app's exact S2S OBO selector policy, its `1.2.0` composition descriptor row, the optional `serviceTenancy` field on `IdentityAuthBindingInput`, and the auth-hono binding wiring that builds `ports.serviceTenant` itself. No schema work, no frozen-contract edits, no new error codes.

## Scope / Guardrails
- Scope limited to the G3 path list of design §10.4: `packages/cluster-mesh/src/identity-contracts/service-tenancy.ts` (new), `composition-descriptors.ts` (new, G3 creates the file — no other lot landed first), `custody-auth.ts` (one optional input field), `identity-contracts/index.ts` (additive export lines), `src/identity/auth-service-tenant.ts` (new binding wiring), `src/identity/auth-binding.ts` (wire-in), `src/identity/auth-hono.ts` (subpath export line), `tests/identity/service-tenancy.spec.ts` (new), `packages/cluster-mesh/package.json` (version bump).
- G1 (lot `feat/cm-a4-gaps-g1-oauth-reads`) is delayed: its branch is still at `origin/main` head, so `OAuthTenantStoreV1` / `oauth-reads.ts` / the durable `findServiceClientBinding` do not exist yet. Per design §10.4 fallback, G3's domain half is built and tested against doubles with a LOCAL fixture in the spec file; G3 does NOT land its own copy of the finder (no edits to `identity-stores/tenancy-*.ts` or `identity-contracts/doubles.ts` — those are G1 paths). The binding wiring capability-checks `tx.stores.oauth` for `findServiceClientBinding` and fails closed with `identity_contract_unavailable` on pre-G1 stores; the stack absorbs G1 on rebase (the check becomes `oauthTenantStoreV1(tx)`).
- Frozen-surface discipline (design §3.2): no edit to any frozen 1.0 type/port/error; `TidIssuer`, `OAuthTenantStore`, `IdentityStores`, `IdentityTransactionV1` untouched; no new error codes; `custody-errors.ts` untouched.
- Make-only workflow, no direct docker/npm on host; single Docker lock `.tmp/packets/DOCKER-LOCK.md` taken PER COMMAND via `flock`.
- Root workspace untouched; all work in worktree `tmp/worktrees/a4-gap-G3`.
- Automated tests run on `ENV=test-a4-G3` only, `ENV` always LAST; `make down ENV=test-a4-G3` after (plus `cluster-mesh-pg-down` for the isolated Postgres).
- All new text in English. No secrets read, printed, logged or committed. No `[skip ci]`. Commits via `make commit MSG="..."` only, ≤150 lines, selective staging. `make scope-check` before every commit; push after each commit batch (crash safety).
- Branch: `feat/cm-a4-gaps-g3-service-tenancy` from `origin/main` (`88078a995`; A2.0b merged as PR #882 `812d1f053`, cluster-mesh `0.26.0-dev.6`; G1 head is currently the same commit, so this branch IS the G1 head per §10.0/§10.4). Worktree `tmp/worktrees/a4-gap-G3`. `harness check branch` PASS at creation.
- Design pins: a4-cm-gaps-r2.md sha256 `283cab23…` (normative §3, §6.1, §7, §10.0, §10.4); owner answers 2026-10-30/11-02 (`.tmp/cm-identity-agents/owner-answers-20261030.md`) — Q-K/Q-WS1/Q-IDP1 do not touch P3.
- Selector policy is byte-for-byte the current app policy (`origin/feat/app-cm-a4` `api/src/services/auth/service-tenant-adapter.ts`): authorized set = fixed `cm_service_clients` binding (active tenant only) UNION active enrollment tenant ids, compared by `tid` slug; 0 → `no_authorized_tenant`, 1 → omitted binds / mismatch `tenant_not_authorized`, >1 → selector mandatory (`tenant_selector_required`) and must be in-set; refusals returned not thrown; empty `clientId` throws `identity_material_invalid`; the three `invalid_target` description strings preserved verbatim; audit `s2s_obo_mint` with outcomes `minted` / `rejected_invalid_target`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/src/identity-contracts/service-tenancy.ts`
  - `packages/cluster-mesh/src/identity-contracts/composition-descriptors.ts`
  - `packages/cluster-mesh/src/identity-contracts/custody-auth.ts`
  - `packages/cluster-mesh/src/identity-contracts/index.ts`
  - `packages/cluster-mesh/src/identity/auth-service-tenant.ts`
  - `packages/cluster-mesh/src/identity/auth-binding.ts`
  - `packages/cluster-mesh/src/identity/auth-hono.ts`
  - `packages/cluster-mesh/tests/identity/service-tenancy.spec.ts`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json` (BR-G3-EX1)
  - `api/package-lock.json` (BR-G3-EX1)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (BR-G3-EX1)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (BR-G3-EX1)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/cluster-mesh/src/identity-stores/**` (G1 paths — no finder copy)
  - `packages/cluster-mesh/src/identity-contracts/doubles.ts` (G1 path)
  - `packages/cluster-mesh/src/identity-contracts/custody-errors.ts` (no new codes)
  - `packages/cluster-mesh/src/identity-contracts/{ports,types,custody,tenancy,resolution,descriptors,custody-descriptors}.ts` (frozen / other lots)
  - `packages/cluster-mesh/tests/**` except `tests/identity/service-tenancy.spec.ts`
  - `api/**`, `ui/**`, `e2e/**`, `apps/**`, other `packages/**`, `.github/workflows/**`, `spec/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none needed
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- BR-G3-EX1: mechanical release-train lock sync for the `0.26.0-dev.7` bump — the CI `changes` job (train lock-sync, BRDP-EX10) requires the root lock, the api lock and the frozen `selected` packaging fixture to carry the bumped version. Refreshed through make targets only (`make lock-root`, `make -f packages/cluster-mesh/packaging.mk refresh-lazy-package-lock`), the exact file set 45e961c8e synced for dev.6. Impact: version-string lines only, no dependency re-resolution. Rollback: revert the sync commit.
- G1-delayed fallback (design §10.4): the both-profile binding mint/refuse/rollback-audit cases of §7.5 need G1's durable `findServiceClientBinding`; they land on rebase after G1 merges ("the stack absorbs G1 on rebase"). Until then the binding wiring is proven fail-closed (`identity_contract_unavailable`) on both profiles, and the full decision table runs at domain level over doubles.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single lot G3, one branch, one scoped spec file; no sub-workstreams)
- [ ] **Multi-branch**
- Rationale: one CM lot on one stacked branch; G1 absorption happens by rebase, not by parallel branch.

## UAT Management (in orchestration context)
- No UI surface; package-level acceptance only. No user UAT required.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`, design a4-cm-gaps-r2.md §0/§3/§6/§7/§10.0/§10.4/§12, owner answers.
  - [x] Worktree `tmp/worktrees/a4-gap-G3` on `feat/cm-a4-gaps-g3-service-tenancy` from `origin/main` (`88078a995`); `harness check branch` PASS.
  - [x] Gates captured: `make typecheck-cluster-mesh`, `make build-cluster-mesh`, `make test-cluster-mesh SCOPE=…`, `make -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk cluster-mesh-identity-test` (both profiles), `make down`.
  - [x] Environment: `ENV=test-a4-G3` always LAST; commands under `flock .tmp/packets/DOCKER-LOCK.md`.
- [ ] **Lot 1 — Tests first: `tests/identity/service-tenancy.spec.ts`**
  - [ ] Domain decision table over local doubles (0/1/N × selector omitted/matching/foreign; fixed-only, enrollment-only, union overlap fixed-wins; suspended/offboarded/missing tenant in either leg; empty clientId throws; store errors propagate).
  - [ ] Domain audit: exactly one `s2s_obo_mint` event per call on both outcomes, fixed `outcome=` detail token, no requested value in the event.
  - [ ] Binding integration both profiles (a20b harness): `serviceTenancy` + `hostPorts.serviceTenant` → construction throws `identity_material_invalid`; absent `serviceTenancy` → host port passes through; `serviceTenancy` on pre-G1 stores → construction fails closed `identity_contract_unavailable`.
  - [ ] Lot gate: `make test-cluster-mesh SCOPE=tests/identity/service-tenancy.spec.ts ENV=test-a4-G3` (red until implementation lands).
- [ ] **Lot 2 — Implementation**
  - [ ] `src/identity-contracts/service-tenancy.ts`: contract + `createServicePrincipalTidIssuerV1` (selector algorithm, audit port for standalone compositions).
  - [ ] `src/identity-contracts/composition-descriptors.ts`: bundle `1.2.0`, row `service_principal_tenancy`.
  - [ ] `src/identity-contracts/custody-auth.ts`: optional `serviceTenancy` field on `IdentityAuthBindingInput<H>`.
  - [ ] `src/identity/auth-service-tenant.ts` + `auth-binding.ts` + `auth-hono.ts`: binding wiring (conflict throw, capability check, port construction, `s2s_obo_mint` through the binding audit buffer).
  - [ ] `src/identity-contracts/index.ts`: additive export lines.
  - [ ] `packages/cluster-mesh/package.json`: version `0.26.0-dev.7` (> published `0.25.0`, > main `0.26.0-dev.6`).
  - [ ] Lot gates green: typecheck, build, spec on SQLite, same spec under the PostgreSQL vitest config, frozen `auth-completion.spec.ts` unmodified green.
- [ ] **Lot N — Final validation**
  - [ ] `make scope-check` before each commit; atomic `make commit` ≤150 lines; push `feat/cm-a4-gaps-g3-service-tenancy` after each commit batch.
  - [ ] Both-profile identity campaign green (`cluster-mesh-identity-test`), then `cluster-mesh-pg-down` + `make down ENV=test-a4-G3`.
  - [ ] Open READY (non-draft) PR with this BRANCH.md text as body; run ONE CI on the final head; record result (expected possible red on security-container from the unrelated libexpat CVE — report, do not fix).
  - [ ] Report to `.tmp/rv/a4-gap-G3.md` (PR, head, CI, each acceptance item, G1-delayed fallback note). Do not merge.
