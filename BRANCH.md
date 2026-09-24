# Feature: L-C-shell package substitution

## Objective
- [ ] Complete S5–S8 from the independent lcshell audit with no visible or lifecycle regression.

## Scope / Guardrails
- [x] Worktree `tmp/chat-lc-shell-v2`, branch `feat/chat-lc-shell-v2`; harness branch check passes.
- [x] Docker via make only; ENV=lcshell-v2 last; API_PORT=9161 UI_PORT=5361 MAILDEV_UI_PORT=1261.
- [x] Keep version 0.34.0; owner accepts removal of widget renderShell in 0.x. ChatPanel renderShell remains.
- [x] E2E is CI-only; no local E2E, no PR creation or merge.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `packages/chat-ui/**`
  - [x] `ui/src/lib/components/**`
  - [x] `ui/src/app.css`
  - [x] `ui/tests/**`
  - [x] `BRANCH.md`
  - [x] `TEST_CHANGES.md`
  - [x] `package-lock.json`
  - [x] `ui/package-lock.json`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `api/**`
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `.github/**`
- [x] **Conditional Paths**:
  - [x] `e2e/tests/**` only if an existing selector cannot preserve meaning; avoid changes.

## Feedback Loop
- [x] Owner explicitly requires TEST_CHANGES.md and chat-ui lock metadata; allowed above.
- [x] CI selection and failure propagation belong to parallel branch fix/ci-e2e-truthful.
- [ ] Independent astra-xhigh review of every registered test change remains an acceptance dependency.

## AI Flaky tests
- [x] No assertion weakening, timeout increases, skips or flaky waivers authorized.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: implementation here; CI fixes and independent review owned by orchestrator.

## UAT Management (in orchestration context)
- [ ] UAT and CI qualify the final integrated revision; no local E2E.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, template and audit; verify clean baseline and mechanical branch check.
- [x] S5: export typed package ChatWidgetPager with conditional list, persistent conversation, live region and 180ms reduced-motion-aware CSS.
- [x] S5 tests: add packages/chat-ui/tests/chat-widget-pager.dom.spec.ts for mount identity, draft, eligibility, headers and announcements; DOM gate running.
- [x] S6: adopt package pager in app; preserve ChatPanel binding and focus callbacks; remove app list/motion containers.
- [x] S7: typed renderContentGate; host loading/auth/onboarding actions; package header/tabs outside gate.
- [x] S8: package header, TabBar, routing and pager composition; promote host snippets; remove widget takeover; preserve grip and overflow.
  - [x] Atomic activation exceeds 150 changed lines because host snippet promotion and removal of the public override must move together.
  - [x] Package header composes TabBar, uses app grip/cursors, gray border and unclipped content.
- [ ] S8 tests: assembly/gate DOM suites, boundary/export assertions, updated ui/tests/components/chat/ChatWidget-*.test.ts; register each hunk.
- [ ] UAT web: floating/docked/fullscreen geometry, mobile burger, list/conversation/Back/focus, all-workspaces, jobs/comments and settings overflow.
- [ ] UAT Chrome: overlay/sidepanel, comments suppression, auth/settings, single composer.
- [ ] UAT VSCode: loading/auth/onboarding actions and theme parity.
- [ ] Docs: final manifest/declarations/reference ownership, 0.34.0 breaking-change note, TEST_CHANGES.md and build REPORT.md.
- [ ] Final validation: make typecheck-ui ENV=lcshell-v2.
- [ ] Final validation: make lint-ui ENV=lcshell-v2.
- [ ] Final validation: make test-ui ENV=lcshell-v2.
- [ ] Final validation: make test-chat-ui ENV=lcshell-v2.
- [ ] Final validation: make test-chat-ui-dom ENV=lcshell-v2.
- [ ] Final cleanup: make down ENV=lcshell-v2; push each slice; handoff exact results and unverified acceptance items.
