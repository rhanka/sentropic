# Feature: BR-53 / ARCH-02 public-app-auth study — SPEC_EVOL_PUBLIC_APP_AUTH

## Objective
Author the missing `SPEC_EVOL_PUBLIC_APP_AUTH` deliverable registered at `PLAN.md:632` and
`spec/SPEC_EVOL_ARCHITECTURE.md:707`, so BR-53 stops being an unstarted gate on BR-62
(`PLAN.md:646`) — the `diag.sent-tech.ca` anonymous-first proof, i.e. the owner's "mode no-auth +
opt-in auth". Study/decision document only — no code, no schema, no migration. Produced under the
repo's double adversarial review cadence (Opus 4.8 xhigh + Codex 5.6-terra xhigh, independent,
CONVERGED on the headline and on every load-bearing decision).

## Scope / Guardrails
- Documentation only: ONE new file under `spec/`. No source, schema, migration, test, CI or Makefile change.
- No services started; no `ENV`, no ports needed.
- All new text in English.
- Evidence-first: every technical claim carries a `path:line` read from live code, not recalled.
- Respects adjacent boundaries: ARCH-13 quotas (BR-47 DONE), ARCH-15 retention (BR-56), the IdP (BR-39),
  ARCH-16 canvas — cited, never redesigned.
- Ratified decisions respected, not relitigated: D3=A, D4 dual-phase, D8, D9.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/SPEC_EVOL_PUBLIC_APP_AUTH.md` (new)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `.github/workflows/**`
  - `api/**`, `ui/**`, `packages/**`, `apps/**`
  - `PLAN.md` and every other `spec/**` file
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception)**: none.
- **Exception process**: declare `BR-53-EXn` in `## Feedback Loop` before touching any
  conditional/forbidden path.

## Feedback Loop
- `BR-53-N1` (`acknowledge`): the BR-39n gate on this branch was proven FALSE by both evaluators and
  struck in PR #453 (separate branch, `docs/plan-br39n-gate-correction`). This study documents the
  finding in §0 with its production proof; it does not re-edit `PLAN.md` here.
- `BR-53-N2` (`attention`, cross-branch): BR-62 is NOT unblocked by accepting this study. Two co-gates
  remain and are named in §5 — the VERIFIED-UNMET XFF/trusted-proxy prerequisite
  (`ui/nginx/default.conf` forwards no `X-Forwarded-For`; `api/src/app.ts` has no trusted-proxy config;
  `spec/SPEC_EVOL_QUOTA_LEDGER.md:11,42`), owner-assigned to a dedicated `fix/*` branch, and BR-56
  retention (`spec/SPEC_EVOL_DATA_LIFECYCLE.md`, PR #454).
- `BR-53-N3` (`attention`, highest-severity finding): `users.role` DEFAULTS to `'guest'`
  (`api/src/db/schema.ts:150`) and `'guest'` already denotes a downgraded registered human
  (`api/src/routes/auth/login.ts:83-84`) — so a naive D3 guest insert would be indistinguishable from a
  suspended real account and would inherit `guest` RBAC. Decision A1 encodes the guest on
  `account_status` instead. This MUST be honoured by the implementation lot.
- `BR-53-N4` (`acknowledge`): a live-code contradiction is recorded rather than smoothed over — the
  published `createDefaultTransport` sends NO credentials (`packages/chat-ui/src/client/transport.ts:159,163-171`)
  while `streamHub.ts:366-370` sets `withCredentials:true`. Same-origin is mandatory either way (A5).
  Worth a chat-lane follow-up.
- `BR-53-N5` (`acknowledge`): evaluator divergences are recorded in §6 rather than averaged — SSE
  credentials, factory-extraction scope, and the guest-status encoding. The better-grounded position was
  adopted each time, with the reason stated.

## AI Flaky tests
- No AI generation surface touched. N/A.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single final test cycle)
- [ ] **Multi-branch**
- Rationale: one orthogonal study document; no code, no CI surface.

## UAT Management (in orchestration context)
- No UI or API surface. UAT = owner/architect review of the decisions and of the cited evidence.
  No browser UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Grounding**
  - [x] Read `PLAN.md:632,646`, `spec/SPEC_EVOL_ARCHITECTURE.md:707` and the guest/anonymous block,
        `spec/SPEC_EVOL_QUOTA_LEDGER.md:20,21,39,53` (what ARCH-13 hands to ARCH-02).
  - [x] Confirm `spec/SPEC_EVOL_PUBLIC_APP_AUTH.md` did not exist.
  - [x] Verify what the IdP emits TODAY (`packages/auth-hono/src/oauth/**`) instead of assuming a gap.

- [x] **Lot 1 — Double adversarial review**
  - [x] Two independent evaluators on the same brief, with BR-39n treated as a PARAMETER rather than a blocker.
  - [x] Both returned: ARCH-02 needs no new claim. Production verification closed the residual doubt
        (`auth.sent-tech.ca` discovery advertises `tid`).
  - [x] Reconcile; record divergences explicitly (§6).

- [x] **Lot 2 — Author the spec**
  - [x] §0 headline (BR-39n struck, with the mechanism that dissolves it) + §1 scope frame.
  - [x] §2 decisions A1..A13. §3 verified FK merge inventory (§3A-§3D + the six UNIQUE-collision sites).
  - [x] §4 seven-item minimum gate set. §5 remaining co-gates. §6 divergences. §7 open questions.

- [ ] **Lot 3 — Review & close**
  - [ ] Architect/owner review of the decisions.
  - [ ] PR with this `BRANCH.md` as body.
  - [ ] On acceptance: BR-53 ceases to be an unstarted gate on BR-62.

## Checks (results)
- Documentation-only branch: no typecheck/lint/test surface touched, so no make gate applies.
- Production verification performed during authoring: `auth.sent-tech.ca` OIDC discovery returns
  `claims_supported` including `tid` — falsifying the premise the BR-39n gate rested on.
- Non-existence claims verified rather than assumed: `spec/SPEC_EVOL_PUBLIC_APP_AUTH.md` absent before
  this branch; no `X-Forwarded-For` directive in `ui/nginx/default.conf`; no trusted-proxy config in
  `api/src/app.ts`.
- The FK inventory in §3 was read from `api/src/db/schema.ts` at line granularity, not recalled.

## Notes
- E2E / UI / API tests: N/A (no executable surface).
- This branch authors the CONTRACT. The seven-item minimum gate set (§4) is implemented in BR-62's lots.
- The merge/FK-re-key engine is PHASE 2: under D9, Diag phase-1 persistence is documents + S3, and
  `context_documents` carries no user column at all (§3D) — so the phase-1 artifact plane needs zero
  merge work.
