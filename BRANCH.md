# Fix: chat-ui inter-message spacing polish (space-y-2 -> space-y-3)

## Objective
Increase the vertical spacing between chat timeline items so consecutive turns (assistant -> next user, user -> next) are not too tight, per owner UAT feedback (2026-07-05). Changes the list container spacing from `space-y-2` (8px) to `space-y-3` (12px) in `ChatPanelShell`, and the matching invisible hydration-measure staging block so first-batch measurement stays consistent.

## Scope / Guardrails
- Scope limited to `packages/chat-ui/**`.
- This is a DEFAULT visual change: it shifts the gold-parity reference screenshots. It requires owner visual sign-off before merge — do NOT merge without UAT.
- Patch bump 0.23.0 -> 0.23.1 (visual tweak). If PR #398 (0.24.0) merges first, rebase and rebump at merge time.
- Make-only; worktree `tmp/chatui-spacing`; ENV=test-spacing (API 9530 / UI 5630 / MAILDEV 1530).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `packages/chat-ui/**`
  - `BRANCH.md`
- **Forbidden Paths**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `api/**`, `ui/**`, `e2e/**`, other `packages/*`
- **Conditional Paths**:
  - `.github/workflows/**` (not touched)

## Feedback Loop
- `attendu` — owner UAT: confirm the new inter-message spacing feels right (assistant->user and user->next). space-y-3 is the first proposal; can tune to a custom value if preferred.

## AI Flaky tests
- None.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: one CSS spacing change in one package.

## UAT Management (in orchestration context)
- Requires owner visual validation (default look changes). Hands-on retest on the branch stack, owner confirms the amount.

## Plan / Todo (lot-based)
- [x] **Lot 1 — spacing**
  - [x] `ChatPanelShell.svelte`: list container + hydration-measure block `space-y-2` -> `space-y-3`.
  - [x] Regenerate theme css (drift guard).
  - [x] Patch bump 0.23.0 -> 0.23.1 + version-pin tests + export-manifest.
  - [x] Lot gate: `make typecheck-chat-ui` + `make test-chat-ui` (827) green.
- [ ] **Lot 2 — owner UAT** (attendu): confirm/tune the spacing amount, then merge.
