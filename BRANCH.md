# Feature: cluster-mesh identity A2.3 — fresh decision, cascade, ledger (F09–F10, F14–F15)

## Objective
- [ ] Deliver lot A2.3 of the identity core (spec r2 `f24480ee…`, lots file `.tmp/cm-identity-agents/A2-lots.md`): the fresh per-request decision producer over the frozen A2.1/A2.2 store ports, the conversation authority store binding for §2.7 `conversation_turn`, the F14 person cascade composition, and the durable audit/escalation ledger for §7 records (collection only until L3).
- [ ] Frozen contracts stay untouched: `packages/cluster-mesh/src/identity-contracts/**` and `tests/identity-lifecycle.spec.ts`, `tests/identity-membership.spec.ts`, `tests/identity-resolution.spec.ts` are never modified; the frozen suite runs unmodified as the reference oracle.
- [ ] Disjoint store slices: this lot implements only its own slice (conversation authority store, audit/escalation ledger) on both storage profiles; it never touches the A2.1/A2.2 record classes or another lot's stores.

## Scope / Guardrails
- Scope limited to `packages/cluster-mesh` (new `src/identity/` module set, its specs, version train); no app change, no screen, no API composition, no kernel change.
- Unbound input kinds (`agent_plane`, `runtime_pty`) keep refusing `session_authority_unavailable` (M4 binds them); no speculative agent-plane records land here.
- Refusals yield an empty tool set, never a partial catalogue; every verdict names its §2.7 session authority.
- No `TENANT_RESOLUTION_MODE`-style permanent mode machinery is introduced (F12 transition tooling is A2.2's; A4.3 deletes it at cutover).
- Make-only workflow, no direct Docker commands; Docker steps one at a time under the repo flock (`/home/antoinefa/.cache-tmp/sentropic-docker.lock`).
- Branch development in isolated worktree `tmp/worktrees/cm-identity-a2-3` on `feat/cm-identity-a2-3` from `origin/main fb454cb4c`.
- Automated tests on dedicated environment `ENV=test-cm-a2-3` (never `dev`), `ENV=` last argument; `make down ENV=test-cm-a2-3` after Docker steps; the PostgreSQL qualification container is removed via `cluster-mesh-pg-down`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/identity/**` (new A2.3 module set)
  - `packages/cluster-mesh/src/index.ts` (public export of the A2.3 surface)
  - `packages/cluster-mesh/tests/identity-decision.spec.ts`
  - `packages/cluster-mesh/tests/identity-cascade.spec.ts`
  - `packages/cluster-mesh/tests/identity-ledger.spec.ts`
  - `packages/cluster-mesh/tests/identity-profiles.spec.ts`
  - `packages/cluster-mesh/package.json` (dev bump, see A23-EX1)
  - `packages/cluster-mesh/tests/fixtures/reserved-versions.ts` (A23-EX1)
  - `packages/cluster-mesh/tests/storage/pack-only-dev-gate.mjs` (A23-EX1)
  - `packages/cluster-mesh/tests/storage/pack-only-dev-gate.spec.ts` (A23-EX1)
  - `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts` (A23-EX1)
  - `package-lock.json` (A23-EX2, version-sync line only)
  - `.gitignore` (A23-EX4, one-line anchor `identity/` → `/identity/`)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `api/**`
  - `ui/**`
  - `packages/cluster-mesh/src/identity-contracts/**` (FROZEN by A2.0, merged #855)
  - `packages/cluster-mesh/tests/identity-lifecycle.spec.ts` (frozen contract suite)
  - `packages/cluster-mesh/tests/identity-membership.spec.ts` (frozen contract suite)
  - `packages/cluster-mesh/tests/identity-resolution.spec.ts` (frozen contract suite)
  - `packages/cluster-mesh/src/storage/**` (kernel; A2.3 consumes its published driver/connection contracts only)
  - `packages/cluster-mesh/assets/**` (kernel PG assets; A2.3 ships its own schema DDL in `src/identity/`)
  - `.github/workflows/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none
- **Exception process**:
  - Declare exception ID `A23-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- A23-EX1: owner=A2.3 lane author; review_by=PR merge; the `src/` change requires a package version bump (workflow gate), main carries the reserved line `0.25.0` while npm latest stays `0.24.0`, so this branch carries `0.26.0-dev.1` (next free dev version) and moves the reserved-next train one line forward exactly per A2.0 precedent BRA2-EX2: `RESERVED_NEXT` `0.25.0`→`0.26.0` in `tests/fixtures/reserved-versions.ts` + `tests/storage/pack-only-dev-gate.mjs`, one-line vector roll in `tests/storage/pack-only-dev-gate.spec.ts` + `tests/packaging/prepare-artifacts.spec.ts`; frozen published pin stays `0.24.0` (0.25.0 is not on npm). Impact limited to version-train test support, no frozen range widened; rollback by reverting the branch. If another A2 lot lands its dev bump first, rebase and take the next free `-dev.N`.
- A23-EX2: owner=A2.3 lane author; review_by=PR merge; single-line root `package-lock.json` version sync for `packages/cluster-mesh` (CI train lock-sync assertion; precedent A2.0 BRA2-EX3 `db534d4b9`); full lock regeneration output is reverted except that line; rollback by reverting the commit.
- A23-EX3: owner=A2.3 lane author; review_by=PR merge; whole-module commits above the 150-line advisory for new files (`src/identity/*.ts`, new specs) so every commit holds complete compilable modules instead of half-file hunks (precedent A2.0 BRA2-EX1); impact limited to this branch history; rollback by reverting the branch.
- A23-EX4: owner=A2.3 lane author; review_by=PR merge; one-line root `.gitignore` anchor `identity/` → `/identity/` (line 48, "Local agent/tooling state" block added by BR-39c `f3a3d4210`). The unanchored pattern matches ANY directory named `identity` at any depth, so it silently swallows this lot's Allowed Path `packages/cluster-mesh/src/identity/**` (and every future file the identity core lands there, e.g. the M4 agent plane). Anchoring preserves BR-39c's root-local intent (root `identity/` stays ignored) and unblocks tracking the package module; impact: one line of shared repo state, no behavior change for existing tracked files; rollback: revert the commit.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - This branch adds deterministic local specs only (disposable PostgreSQL schema, temp-file SQLite); the PostgreSQL qualification container start is awaited via `pg_isready` and is not a flaky lane.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one implementation lot with a single test cycle; the other A2 lots run in parallel on their own branches, disjoint by contract.

## UAT Management (orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UAT checkpoint in this branch: no UI change, no user-facing behavior; package-level work only.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read COMMON-RULES, MASTER, workflow rules, spec r2, A2-lots parallelism contract, owner answers, gap document.
  - [x] Create isolated worktree `tmp/worktrees/cm-identity-a2-3` on `feat/cm-identity-a2-3` from `origin/main fb454cb4c`; branch verified with `git branch --show-current`.
  - [x] `harness check branch` PASS (C1).
  - [x] Capture Makefile targets: `test-cluster-mesh` (SCOPE=), `typecheck-cluster-mesh`, `build-cluster-mesh`, `cluster-mesh-pg-test`/`cluster-mesh-pg-down` (postgres.mk), `scope-check`, `commit`, `down`.
  - [x] Environment mapping: `ENV=test-cm-a2-3`, port slot convention API `8833` / UI `5233` / Maildev `1133` (no compose service needed for this package-only lot; the PostgreSQL qualification container runs on its own network `cm-storage-test-cm-a2-3`).
  - [x] Confirm scope and guardrails; declare A23-EX1/EX2/EX3.

- [x] **Lot 1 — A2.3 logic slice over the frozen ports (test first)**
  - [x] `src/identity/conversation.ts`: `ConversationSessionRecord`, `ConversationAuthorityStore` port, `createConversationAuthority` domain (open/verify/revoke, fail-closed expiry), in-memory double.
  - [x] `src/identity/ledger.ts`: `IdentityLedgerStore` port (audit events + §7.3 escalation entries), hash-linked append-only chain, collection-only regime (`collected` → `approved_unexecutable` | `denied` | `expired`), chain verification, in-memory double.
  - [x] `src/identity/decision.ts`: `createFreshDecisionProducer` binding the §2.7 matrix — `first_party_http` delegates to the frozen `createFreshDecision`; `conversation_turn` binds the conversation authority store; `agent_plane`/`runtime_pty` keep refusing `session_authority_unavailable`; injected tool catalog; refusal ⇒ empty tool set, never partial.
  - [x] `src/identity/cascade.ts`: F14 composition helper binding the frozen `createPersonCascade` over the store ports + the durable ledger audit port (+ `AgentPlaneRevocationPort` slot, unbound until M4).
  - [x] Specs: `tests/identity-decision.spec.ts` (HTTP expiry vs logout-during-turn vs conversation revocation as separate cases; mid-session suspension empties the tool set on the next call; unbound kinds), `tests/identity-cascade.spec.ts` (receipts enumerate every step; one injected step failure left queued and visible), `tests/identity-ledger.spec.ts` (collection regime, chain integrity, tamper refusal).
  - [x] Export the A2.3 surface from `packages/cluster-mesh/src/index.ts`.
  - [x] Lot gate: `make typecheck-cluster-mesh ENV=test-cm-a2-3`; frozen suite + new specs green via `make test-cluster-mesh SCOPE=tests/identity- ENV=test-cm-a2-3`.

- [ ] **Lot 2 — Durable store slice on both profiles**
  - [ ] `src/identity/postgres.ts`: `ConversationAuthorityStore` + `IdentityLedgerStore` over the kernel's published `InjectedPgDriver` protocol, parameterized schema, package-owned DDL (`identityEnforcementPgSchema()`).
  - [ ] `src/identity/sqlite.ts`: same ports over the kernel's SQLite engine/connection (`openSqliteEngine` module identity), idempotent `cm_identity_*` schema set.
  - [ ] `tests/identity-profiles.spec.ts`: the same scenario corpus against the in-memory double (reference oracle), the PostgreSQL profile (disposable schema, gated on `CM_PG_URL`), and the SQLite profile (temp-file store), plus a per-profile decision replay through `createFreshDecisionProducer`.
  - [ ] Lot gate: `make -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk cluster-mesh-pg-test SCOPE=tests/identity-profiles.spec.ts ENV=test-cm-a2-3`, then `cluster-mesh-pg-down ENV=test-cm-a2-3`.

- [ ] **Lot 3 — Version train**
  - [ ] A23-EX1: bump `packages/cluster-mesh/package.json` to `0.26.0-dev.1`, move `RESERVED_NEXT` to `0.26.0`, roll the dev-gate vectors one line forward.
  - [ ] A23-EX2: single-line `package-lock.json` version sync.
  - [ ] Lot gate: `make typecheck-cluster-mesh ENV=test-cm-a2-3`; dev-gate specs green.

- [ ] **Lot 4 — Acceptance & train**
  - [ ] Frozen contract suite unmodified, full run: `make test-cluster-mesh SCOPE=tests/identity- ENV=test-cm-a2-3` (frozen three + A2.3 specs).
  - [ ] `make scope-check` clean before every commit; atomic commits via `make commit`.
  - [ ] `make down ENV=test-cm-a2-3` after Docker steps; report image growth if any.
  - [ ] Draft PR to main (BRANCH.md text as body); push `--force-with-lease` on `feat/cm-identity-a2-3` only; ONE CI run on the final head; wait completed/success.
  - [ ] Write report `.tmp/rv/lot-A2.3.md` (PR, head, CI run id + conclusion, acceptance item by item); stop. Do not merge.
