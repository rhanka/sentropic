# Feature: cluster-mesh custody and effect-semantics contract (0.9.0)

## Objective
Make `context.custody` mandatory and implement the owner-ratified OQ1/OQ2/OQ3 effect-semantics contract, with OQ12 documented as source-gap / à-affiner.

## Scope / Guardrails
- Scope limited to `packages/cluster-mesh` (runtime gate, session router, contracts, tests, and version).
- No migration file (no schema change).
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development in isolated worktree `tmp/feat-cluster-mesh-custody-mandatory`.
- Automated tests on dedicated env, never on root `dev`.
- `ENV=<env>` last argument in every `make` command.
- All new text in English.
- LANDING (push/PR/merge) HELD: gated on owner sequencing arbitration (lot-0 order) + owner direct merge GO in this session's channel. Merge is this repo's domain (sentropic/cluster-mesh); 2-among model review {Fable5.1/Gemini3.8/Astra} run by h-cond before merge.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths (only with explicit `BRxx-EXn`)**:
  - `api/drizzle/*.sql` (N-A here)
  - `.github/workflows/**`
- **Exception process**: declare `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `attention` — BR-CUS-A1: LANDING held pending owner sequencing arbitration (custody-mandatory as lot-0) + owner direct merge GO. Branch prepared, not pushed.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single isolated contract change; single test cycle)
- [ ] **Multi-branch**
- Rationale: One small, orthogonal, breaking contract change in a single package.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Worktree `tmp/feat-cluster-mesh-custody-mandatory` created off `origin/main` (18fb693e).
  - [x] Baseline confirmed: cluster-mesh 0.8.1, custody opt-in.
  - [x] Scope/guardrails confirmed; landing held (owner-gated).

- [x] **Lot 1 — Custody mandatory (fail-closed)**
  - [x] `registration.ts`: add `custody_required` to `RegistrationFailureReason`.
  - [x] `registration.ts`: deny when `!context.custody` (`custody_required`); drop the `&& context.custody` opt-in guards on epoch/holder checks (now unconditional).
  - [x] `package.json`: bump `0.8.1 → 0.9.0` (pre-1.0 breaking semantics → minor).
  - [x] `tests/registration.spec.ts`: add "should fail closed with custody_required when the context carries no custody" (asserts deny + no actuator probing).
  - [ ] Lot gate:
    - [x] `make typecheck-cluster-mesh`
    - [x] cluster-mesh gate tests green (`registration.spec.ts`)

- [ ] **Lot 2 — Effect semantics (locked OQ1/OQ2/OQ3 + documented OQ12)**
  - [x] Add `ActuationOutcome`, `TargetLiveness`, `SignedInstruction`, and `CommandInstructionPort`.
  - [x] Make actuator selection and registration authorization action-aware.
  - [x] Resolve authenticated command instructions in the session router before actuation.
  - [x] Record acted commands and receipts only for an `acted` outcome.
  - [ ] Add focused contract, router, and hermetic fixture coverage.
  - [ ] Document the OQ12 CLI delegation route invariant as source-gap / à-affiner.
  - [ ] Lot gate:
    - [ ] `make typecheck-cluster-mesh`
    - [ ] `make test-cluster-mesh SCOPE=packages/cluster-mesh/tests/... ENV=test-cluster-mesh-0900`

- [ ] **Lot N — Final validation** (HELD on owner GO)
  - [x] Bumped `packages/cluster-mesh/package.json` version.
  - [ ] PR body from `BRANCH.md`; h-cond runs 2-among review.
  - [ ] Merge only on owner direct GO + sequencing arbitration; then remove `BRANCH.md`, push, merge.
