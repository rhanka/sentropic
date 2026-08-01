# Feature: Gmail Connector Settings Card

## Objective
Add a read-only Gmail (`gmail.readonly`) enrollment card to Settings by faithfully mirroring the existing Google Drive connector card and lifecycle.

## Scope / Guardrails
- Scope limited to the Gmail Settings connector card, Gmail connection helpers, existing connector-state resolver, Settings wiring, Gmail locale entries, Gmail utility tests, and this plan.
- Do not change Google Drive behavior or introduce shared abstractions.
- Make-only workflow, no direct Docker commands.
- Automated tests run only with `ENV=test-gmailui`; never use `ENV=dev`.
- All new code, comments, commits, and Markdown are in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/GmailConnectorCard.svelte`
  - `ui/src/lib/utils/gmail.ts`
  - `ui/src/lib/utils/document-source-menu.ts`
  - `ui/src/routes/settings/+page.svelte`
  - `ui/src/locales/en.json`
  - `ui/src/locales/fr.json`
  - `ui/tests/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `api/**`
  - `packages/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `deploy/**`
  - Google Drive helper and card logic
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `api/drizzle/*.sql`
- **Exception process**:
  - Declare `BR-GMAIL-UI-EXn` with reason, impact, and rollback in `## Feedback Loop` before touching a conditional or forbidden path.

## Feedback Loop
- [x] `BR-GMAIL-UI-ACK1` — Local UI tests, typecheck, and lint cannot start because Docker Compose requires unavailable buildx and then rejects the unset local registry image reference. CI must execute the required gates.
- [ ] `BR-GMAIL-UI-REVIEW1` — Completion-review selection failed: the runtime does not expose the author's exact model and effort required by `harness review`, and the allowed paths prohibit a separate review dossier. No peer consensus is claimed.

## AI Flaky tests
- [x] The documented failure signature is OpenAI billing exhaustion: `APIError: You have no credits remaining`.
- [x] AI and billing-dependent E2E failures remain visible in CI and are non-blocking only at the specified scope.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: one focused UI capability has no independent sub-workstream.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and scope**
  - [x] Confirm `feat/gmail-connector-ui-card` starts at `origin/main` commit `abc2b7459`.
  - [x] Run `harness check branch` and inspect the Google Drive card, utility, resolver, Settings lifecycle, locales, and utility tests.
  - [x] Confirm the allowed paths and test environment `test-gmailui`.

- [ ] **Lot 1 — Gmail connector implementation**
  - [ ] Add `GmailConnectorCard.svelte` as the Google Drive card's visual mirror with the `Mail` icon and Gmail-specific identifiers and keys.
  - [ ] Add `gmail.ts` GET/start/disconnect helpers for `/gmail` endpoints and the Gmail connection type.
  - [ ] Add the Gmail connector-state resolver and wire the card lifecycle, OAuth callback status, toasts, and reload in Settings.
  - [ ] Add complete parallel `settings.connectors.gmail.*` entries to English and French locales, with `gmail.readonly` framing.
  - [ ] Add Gmail utility and resolver coverage in `ui/tests/utils/gmail.test.ts` and `ui/tests/utils/document-source-menu.test.ts`.
  - [ ] Lot gate: `make test-ui SCOPE=tests/utils/gmail.test.ts ENV=test-gmailui`.

- [ ] **Lot 2 — Validation and PR**
  - [x] Attempt `make test-ui ENV=test-gmailui`; Docker buildx and the local registry image reference prevent the test runner from starting.
  - [x] Attempt `make typecheck-ui` and `make lint-ui`; the same Docker prerequisite prevents both commands from starting.
  - [ ] Run `make scope-check` before committing.
  - [x] Review the final diff to confirm it only adds Gmail siblings and Settings wiring; Google Drive card and utility remain untouched.
  - [ ] Create and push a PR to `main` using this file as its body; do not merge.
