# Feature: Spectral Site Tools

## Objective
HTTP traffic capture + LLM analysis to auto-generate per-site API tools. Complementary to DOM-based tab_read/tab_action.

## Scope / Guardrails
- Node/TS implementation (no Python). Integrated into shared injected script.
- S3 for traces, DB for metadata + tool definitions + credentials.
- Branch env: `ENV=feat-spectral-site-tools` `API_PORT=8715` `UI_PORT=5115` `MAILDEV_UI_PORT=1015`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `api/**`, `ui/**`, `e2e/**`, `plan/15-BRANCH_feat-spectral-site-tools.md`
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
- **Conditional Paths**: `api/drizzle/*.sql`, `.github/workflows/**`, `spec/**`, `PLAN.md`, `TODO.md`

## Feedback Loop
_(to be populated during execution)_

## AI Flaky tests
- Standard acceptance rule.

## Orchestration Mode (AI-selected)
- [ ] Mono-branch + cherry-pick
- [ ] Multi-branch
- Rationale: TBD after Lot 0.

## UAT Management (in orchestration context)
- Per BRANCH_TEMPLATE.md standard.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline + Spectral deep analysis**
  - [ ] Study Spectral source: capture mechanism, auth detection, analysis engine.
  - [ ] Quantify capture sizes, define S3 strategy.
  - [ ] Define DB schema: sites, captures, tool_definitions, user_site_credentials.

- [ ] **Lot 1 — HTTP traffic capture in injected script**
  - [ ] Intercept fetch/XHR (monkey-patch). Record request/response pairs.
  - [ ] Admin-only tab_capture mode.

- [ ] **Lot 2 — Capture storage + admin UX**
  - [ ] S3 upload + metadata DB. Start/stop capture UX.

- [ ] **Lot 3 — LLM analysis + auth detection**
  - [ ] Traffic -> tool definitions. Auth pattern detection.

- [ ] **Lot 4 — Tool registry + admin review**
  - [ ] Per-site per-workspace registry. Admin validate/edit in /settings.

- [ ] **Lot 5 — User activation + credential enrollment**
  - [ ] URL matching, credential consent flow, revocation UI.

- [ ] **Lot N-2 — UAT**
- [ ] **Lot N-1 — Docs consolidation**
- [ ] **Lot N — Final validation**
