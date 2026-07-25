# Feature: BR-56 / ARCH-15 data-lifecycle study — SPEC_EVOL_DATA_LIFECYCLE

## Objective
Author the missing `SPEC_EVOL_DATA_LIFECYCLE` deliverable registered at `PLAN.md:635` and
`spec/SPEC_EVOL_ARCHITECTURE.md:720`, so BR-56 stops being an unstarted gate on BR-62
(`PLAN.md:646`, diag.sent-tech.ca anonymous-first proof). Study/decision document only — no code,
no schema, no migration. Produced under the repo's double adversarial review cadence
(Opus 4.8 xhigh + Codex 5.6-terra xhigh, independent, CONVERGED), with four owner decisions ratified
2026-07-25 folded in.

## Scope / Guardrails
- Documentation only: ONE new file under `spec/`. No source, schema, migration, test, CI or Makefile change.
- No services started; no `ENV`, no ports needed.
- All new text in English.
- Evidence-first: every technical claim carries a `path:line` citation, verified against live code.
- Respects the boundaries of adjacent studies: ARCH-13 quotas (BR-47 DONE), ARCH-02 auth (BR-53),
  ARCH-18 storage, ARCH-16 canvas — cited, never redesigned.
- Legal positions are stated as the standard defensible posture and explicitly flagged where
  counsel-grade validation is required. No agent-authored legal advice.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/SPEC_EVOL_DATA_LIFECYCLE.md` (new)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `.github/workflows/**`
  - `api/**`, `ui/**`, `packages/**`, `apps/**`
  - `PLAN.md` and every other `spec/**` file
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception)**: none.
- **Exception process**: declare `BR-56-EXn` in `## Feedback Loop` before touching any
  conditional/forbidden path.

## Feedback Loop
- `BR-56-N1` (`acknowledge`): four owner decisions ratified 2026-07-25 and recorded in §1 of the spec —
  exposure = invite-gated (O-EXPO), guest TTL = 30d (O-TTL), controller = Sent-Tech (O-CTRL), diag
  tenant = pooled into `'sentropic'` (O-TENANT). O-TENANT is recorded as an ACCEPTED RISK with its
  consequence stated (anonymous cost + authz blast radius mix into the production tenant), not as an
  oversight.
- `BR-56-N2` (`attention`, cross-branch): three verified live-code defects are named by the spec but
  NOT fixed here (documentation-only branch). They belong to the BR-62 / ARCH-02 implementation lots:
  `comments.created_by` `ON DELETE CASCADE` destroys comments in claimed workspaces
  (`api/src/db/schema.ts:938-940`); `context_documents.workspace_id` has NO `onDelete` so a workspace
  delete is FK-BLOCKED (`:766-769`); no account-deletion route and no `deleteWorkspace` exist in `api/src`.
- `BR-56-N3` (`attention`, orthogonal): `user_sessions.ip_address` stores raw client IP with no
  time-based purge (`api/src/db/schema.ts:193`) → indefinite raw-IP retention. Pre-existing production
  exposure, NOT a Diag gate; the spec (DL-18) recommends its own small branch.
- `BR-56-N4` (`acknowledge`): evaluator divergences are recorded in §5 of the spec rather than
  silently reconciled — TTL duration (Opus 90d vs Codex 30d, resolved by O-TTL) and the blocking status
  of the notice/sub-processor statement (resolved by O-EXPO).

## AI Flaky tests
- No AI generation surface touched. N/A.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single final test cycle)
- [ ] **Multi-branch**
- Rationale: one orthogonal study document; no code, no CI surface.

## UAT Management (in orchestration context)
- No UI or API surface. UAT = owner/architect review of the decisions and of the cited evidence.
  Counsel review is separately required for the items flagged in §6. No browser UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Grounding**
  - [x] Read `PLAN.md:635,646`, `spec/SPEC_EVOL_ARCHITECTURE.md:720,775`,
        `spec/SPEC_EVOL_DATA_ARCHITECTURE.md:425-426` (ARCH-18's assignment to ARCH-15),
        `spec/SPEC_EVOL_QUOTA_LEDGER.md:45,53,57` (what ARCH-13 deferred here).
  - [x] Confirm `spec/SPEC_EVOL_DATA_LIFECYCLE.md` did not exist.
  - [x] Verify every erasure gap against live code rather than inferring it.

- [x] **Lot 1 — Double adversarial review**
  - [x] Two independent evaluators (Opus 4.8 xhigh, Codex 5.6-terra xhigh) on the same brief.
  - [x] Reconcile; record divergences explicitly (§5) instead of averaging them.
  - [x] Batch the owner-only items and obtain ratification (§1).

- [x] **Lot 2 — Author the spec**
  - [x] §0 scope frame + boundaries of adjacent studies.
  - [x] §1 ratified owner decisions. §2 DL-1..DL-18. §3 14-row cross-plane erasure matrix.
  - [x] §4 minimum gate-clearing set for BR-62 under the invite-gated posture.
  - [x] §5 divergences. §6 counsel/owner open questions.

- [ ] **Lot 3 — Review & close**
  - [ ] Architect/owner review of the decisions.
  - [ ] PR with this `BRANCH.md` as body.
  - [ ] On acceptance: BR-56 ceases to be an unstarted gate on BR-62.

## Checks (results)
- Documentation-only branch: no typecheck/lint/test surface touched, so no make gate applies.
- Every `path:line` citation in the spec was read from live code during authoring, not recalled.
- Non-existence claims verified rather than assumed: `spec/SPEC_EVOL_DATA_LIFECYCLE.md` absent before
  this branch; no account-deletion route / `deleteWorkspace` in `api/src`; no outbox prune in
  `api/src/services/outbox/*`; `control.event_audit` not yet created.

## Notes
- E2E / UI / API tests: N/A (no executable surface).
- This branch authors the CONTRACT. The one item with real build content (G3, a working erasure
  primitive reaching PG and S3) is scoped here and implemented in BR-62 / ARCH-02 lots.
- BR-62 remains gated independently on the XFF/trusted-proxy prerequisite
  (`ui/nginx/default.conf` forwards no `X-Forwarded-For`; `spec/SPEC_EVOL_QUOTA_LEDGER.md:11,42`),
  owner-assigned to a dedicated `fix/*` branch. Accepting BR-56 must not be read as "BR-62 unblocked".
