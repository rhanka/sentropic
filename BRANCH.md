# BRANCH — chore/arch-12-contract-compat-study

- Branch: `chore/arch-12-contract-compat-study`
- Mode: mono-branch
- Baseline: origin/main @ e525142a9
- Kind: study (doc-only — produces the ARCH-12 output `spec/SPEC_EVOL_APP_TEMPLATE_LIFECYCLE.md`, the D11 gate)

## Allowed Paths
- [x] `spec/SPEC_EVOL_APP_TEMPLATE_LIFECYCLE.md`
- [x] `BRANCH.md`

## Forbidden Paths
- [x] all code (`api/**`, `ui/**`, `packages/**`), `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `api/drizzle/**`

## Conditional Paths
- [x] none

## Lots
- [x] **Lot 1 — Author ARCH-12 study**
  - [x] Published-contract inventory grounding (16 pkgs, all 0.x, file: masking, enforce-package-bump gaps)
  - [x] Draft `SPEC_EVOL_APP_TEMPLATE_LIFECYCLE.md` (D11 semver policy + app-template lifecycle)
  - [x] Double consensus (Codex 5.5-xhigh + Fable 5) — both GO-WITH-CHANGES
  - [x] Reconcile all must-fixes (full breaking taxonomy incl. union-member-add + required-method-add + must-ignore-unknown-fields wire rule; honest CI snapshot scope; packed-form binding + pack/install smoke + publish-lag; harness/llm-mesh/skills + Svelte-prop + wire-DTO classification; live-issue fixes; flow@0.1.3)
  - [x] Flag 2 owner-grade decisions (contracts-1.0 timing + app-template immutability/rollback guarantees)
- [x] **Lot N — Final**
  - [x] PR (doc-only)

## Feedback Loop
- 2 owner-grade decisions → BATCHED packet (with ARCH-01 OD-1/OD-2 + ARCH-13 budget), presented after ARCH-13.
- This study GATES-OPEN the deferred contract mutations (ARCH-14 comments-executor + EventEnvelope field; flow-adopts-contracts).

## Deferred
- CI public-surface-snapshot + pack/install-smoke gate = a named buildable follow-up lot.
- Per-package CHANGELOG.md + plan/MIGRATION_TEMPLATE.md rollout.
