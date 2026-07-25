# Feature: Strike the false BR-39n gate on BR-53 + correct the two stale claim-set statements

## Objective
Correct a documentation defect that has been blocking BR-62 (diag.sent-tech.ca anonymous-first proof)
on a dependency that does not exist. `PLAN.md` gated BR-53 (ARCH-02 public-app-auth) on "BR-39n
claim-set decisions (IdP lane)". Double adversarial review (Opus 4.8 xhigh + Codex 5.6-terra xhigh,
independent, CONVERGED, both high confidence) established that ARCH-02 needs no new IdP claim, and
production verification confirmed the premise the gate rested on is falsified. Documentation only —
no code, no schema, no behaviour change.

## Scope / Guardrails
- Documentation only: `PLAN.md`, `spec/SPEC_EVOL_ARCHITECTURE.md`, `apps/auth-idp/RP_SESSION_GLUE.md`.
- No source, schema, migration, test, CI or Makefile change. No services started, no ENV needed.
- All new text in English.
- Evidence-first: every corrected statement carries a `path:line` citation or a production verification.
- Does NOT decide ARCH-02 content — it only removes a false gate and fixes two stale premises.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `PLAN.md` (BR-53 gates cell + the external-lanes dependency line)
  - `spec/SPEC_EVOL_ARCHITECTURE.md` (the §2 baseline claim-set statement)
  - `apps/auth-idp/RP_SESSION_GLUE.md` (the Phase A0 claim-set note)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `.github/workflows/**`
  - `api/**`, `ui/**`, `packages/**`, `apps/auth-idp/**` except `RP_SESSION_GLUE.md`
  - `spec/**` except `SPEC_EVOL_ARCHITECTURE.md`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception)**: none.
- **Exception process**: declare `BR-GATE-EXn` in `## Feedback Loop` before touching any
  conditional/forbidden path.

## Feedback Loop
- `BR-GATE-N1` (`acknowledge`): the correction is owner-authorized (2026-07-25) after the finding was
  presented with its evidence. Opus explicitly required that this NOT be done silently, hence the
  inline justification + citations in `PLAN.md` rather than a bare edit.
- `BR-GATE-N2` (`attention`, informational): BR-62 remains gated on BR-56 (ARCH-15 data-lifecycle,
  `SPEC_EVOL_DATA_LIFECYCLE` does not exist) and on the XFF/trusted-proxy prerequisite
  (`ui/nginx/default.conf` forwards `Upgrade`/`Connection`/`Host` but NOT `X-Forwarded-For`;
  `api/src/app.ts` has no trusted-proxy config; `spec/SPEC_EVOL_QUOTA_LEDGER.md:11,42`). Striking the
  BR-39n gate must NOT be read as "BR-62 unblocked". Owner assigned XFF to a dedicated `fix/*` branch.
- `BR-GATE-N3` (`acknowledge`): the BR-53 deliverable cell was also corrected — factory extraction is
  scoped to the `documents` router ONLY. `workspaces` must never be publicly exposed, and `comments`
  is phase 2 (blocked behind the `contextType` `canvas|artifact` extension, D9).

## AI Flaky tests
- No AI generation surface touched. N/A.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single final test cycle)
- [ ] **Multi-branch**
- Rationale: one orthogonal documentation correction; no code, no CI surface.

## UAT Management (in orchestration context)
- No UI or API surface. UAT = owner/architect review of the diff and of the cited evidence. No browser UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Evidence**
  - [x] Double adversarial review of BR-53 scoping (Opus 4.8 xhigh + Codex 5.6-terra xhigh, independent).
  - [x] Both established BR-39n is not a gate: phase 1 needs ZERO IdP claims; phase 2 needs `sub` only.
  - [x] Root cause identified: `SPEC_EVOL_ARCHITECTURE.md` §2 and `RP_SESSION_GLUE.md` predate BR-39e's
        `tid` binding; `PLAN.md` inherited the stale premise.
  - [x] Production verification: `auth.sent-tech.ca` discovery `claims_supported` includes `tid`.
  - [x] Mechanism confirmed: the IdP round-trips `state` verbatim
        (`packages/auth-hono/src/oauth/issue-authorized-code.ts:51`) so the claim ticket stays RP-side.

- [x] **Lot 1 — Corrections**
  - [x] `PLAN.md` BR-53 row: strike the BR-39n gate; narrow the deliverable to the `documents` router.
  - [x] `PLAN.md` external-lanes: BR-39n now gates BR-63 only, with the full justification + citations.
  - [x] `spec/SPEC_EVOL_ARCHITECTURE.md`: replace the stale "emits NO tenant/role/membership claims"
        statement with the verified live claim set and what genuinely remains BR-39n.
  - [x] `apps/auth-idp/RP_SESSION_GLUE.md`: replace the stale Phase A0 note likewise.

- [ ] **Lot 2 — Review & close**
  - [ ] Architect/owner review of the diff.
  - [ ] PR with this `BRANCH.md` as body.

## Checks (results)
- Documentation-only branch: no typecheck/lint/test surface touched, so no make gate applies.
- Evidence re-verified at edit time: production `claims_supported` contains `tid`;
  `ui/nginx/default.conf` contains no `X-Forwarded-For` directive (basis of `BR-GATE-N2`).

## Notes
- E2E / UI / API tests: N/A (no executable surface).
- This branch removes a false blocker; it does not author `SPEC_EVOL_PUBLIC_APP_AUTH` (that is BR-53's
  own deliverable) and does not claim BR-62 is unblocked (see `BR-GATE-N2`).
