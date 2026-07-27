# Feature: Chat placement menu (surfaces L1c-menu)

## Objective
Add a persistent "Move chat to…" menu (Right/Left/Center/Full) to `@sentropic/chat-ui` and wire it into the sentropic web app, with zero behavior change when no menu is supplied.

## Scope / Guardrails
- Scope limited to `packages/chat-ui/**`, the app chat widget, and the chat e2e specs.
- No migration in `api/drizzle/*.sql`.
- Make-only workflow, no direct Docker commands.
- Root workspace is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/chat-l1c`.
- Test campaigns run on `ENV=test-chat-l1c` / `ENV=e2e`, never on root `dev`.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- `@sentropic/chat-ui` stays at `0.29.0` (not yet published).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/chat-ui/src/**`
  - `packages/chat-ui/tests/**`
  - `packages/chat-ui/package.json`
  - `packages/chat-ui/export-manifest.json`
  - `packages/chat-ui/chat-ui-reference-validation.json`
  - `ui/src/lib/components/ChatWidget.svelte`
  - `ui/tests/components/chat/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `e2e/tests/03-chat-mobile-docked-nav.spec.ts`
  - `e2e/tests/03-chat-chrome-extension.spec.ts`
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `acknowledge` BR-L1c-EX1 — e2e specs touched (conditional path). Reason: adversarial review required a real-browser geometry proof and a host-migration proof; jsdom class assertions had already passed while the feature was visually broken. Impact: 3 deterministic tests added, no timeout raised, no existing test weakened. Rollback: revert the two e2e spec hunks.
- `acknowledge` BR01-EX2 — e2e specs touched (conditional path). Reason: the owner-required left/right geometry and drag proofs need the existing browser-host specs. Impact: deterministic bounding-box assertions only; no timeout raised or existing test weakened. Rollback: revert the two e2e spec hunks.
- `attention` — the extension-overlay visibility test lives in `e2e/tests/03-chat-chrome-extension.spec.ts`, which is on the AI-flaky allowlist, because it needs the `mockExtensionRuntime` helper defined there. The test itself is deterministic (no AI). Consequence: a failure there is procedurally waivable; treat any failure of this specific test as blocking.
- `acknowledge` — the e2e specs were never executed locally (the build stack was blocked by a repo-wide `npm audit` gate, then by sandbox Docker permissions). CI is the authority and executed them.
- `acknowledge` BR-L1c-owner-2 — owner rejected the prior UAT surface because the legacy toggle and flat placement menu duplicated intent, had indistinguishable icons, and omitted a left panel. This corrective lot replaces the interaction as specified; no UAT is requested by this build agent.

## AI Flaky tests
- Acceptance rule applied as per `rules/testing.md`.
- Observed on run `30172875706` (HEAD `3101f832d`), both infrastructure, both cleared by a re-run of the same commit (`conclusion: success`):
  - `validate-mcp-auth` — failed at `Setup Docker`, signature: `Error response from daemon: Get "https://registry-1.docker.io/v2/": context deadline exceeded`. No branch file touches `packages/mcp-auth`.
  - `test-smoke-restore` — failed at `Backup production database (k8s in-cluster postgres)`, signature: `GH secret KUBECONFIG_B64 is missing or empty` + `dial timeout` to the prod cluster. No branch file touches k8s, DB or secrets.
- No AI spec failure was accepted as flaky on this branch.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single branch, single final test cycle)
- [ ] **Multi-branch**
- Rationale: one coherent feature in one package plus its host wiring; no independent CI needed.

## UAT Management (in orchestration context)
- Mono-branch: UAT is performed by the owner on the integrated branch, from the root workspace.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Isolated worktree `tmp/chat-l1c` created and used for all work.
  - [x] Environment mapping fixed (`ENV=test-chat-l1c`, `ENV=e2e`), `ENV` passed last.
  - [x] Scope boundaries defined above.

- [x] **Lot 1 — Headless menu model + host wiring**
  - [x] `chatPlacementMenu` model with per-user/host/workspace localStorage persistence (D6).
  - [x] `ChatPlacementMenuButton` component mounted in the app header toolbar.
  - [x] `ChatDock` derives its container placement from the menu; unchanged when no menu is supplied.
  - [x] Lot gate: `make typecheck-chat-ui` + `make test-chat-ui` + `make test-chat-ui-dom` + `make typecheck-ui` + `make test-ui` (`ENV=test-chat-l1c`).

- [x] **Lot 2 — First adversarial review fixes (F1-F5)**
  - [x] F1 Escape/Arrow `stopPropagation` so the popup never closes the dock.
  - [x] F2 menu memoized on the `(userId, hostId, workspace)` tuple.
  - [x] F3 no persistence write on construction (`seedEffectiveFromRequested`).
  - [x] F4 no dead menu in sidepanel.
  - [x] F5 outside-pointerdown dismissal with SSR-safe listener lifecycle.

- [x] **Lot 3 — CI-detected collision fix**
  - [x] Overlay affordance removed from `ChatDock` (it covered the app Close button; caught by `test-e2e (group-c, 03)`).
  - [x] Trigger relocated into the host header toolbar as a normal in-flow control.

- [x] **Lot 4 — Second adversarial review fixes (B1-B4)**
  - [x] B1 desktop floating placements anchored to the viewport (Left/Center were rendering off-screen).
  - [x] B2 `menuOwnsPlacement` so forced host/mobile modes beat the menu.
  - [x] B3 `onPlacementChange` published in the `.d.ts` and the export manifest.
  - [x] B4 tests that passed for the wrong reason replaced (tautology, stale class assertion, source-grep test, non-synchronous seed assertion).
  - [x] Real-browser geometry e2e added and observed passing in CI.

- [x] **Lot 5 — Third adversarial review fixes (R1-R3)**
  - [x] R1 single shared ownership predicate `canChatPlacementMenuOwnPlacement` consumed by both dock and host, so the menu is no longer a dead control in extension overlay / mobile.
  - [x] R2 `publishLayout()` derives ownership from live inputs and republishes on ownership/mode change.
  - [x] R3 host-migration e2e (legacy docked seed to drawer, then menu choice mirrored back into legacy persistence).
  - [x] Lot gate: all five gates green (chat-ui 928, chat-ui-dom 181, test-ui 438, both typechecks 0 errors).

- [ ] **Lot 6 — Owner corrective L2**
  - [x] Replace the duplicate header controls with one titled grouped placement menu and French host labels.
  - [x] Add `drawer.left.primary`, left-edge classes, persistent mode-side restoration, and viewport geometry coverage.
  - [x] Wire the existing drag hit-testing through the placement controller with a pointer-transparent local affordance and Escape cancellation.
  - [ ] Lot gate: package, DOM, app, and real-browser tests; package export artifacts and generated theme remain synchronized.

- [ ] **Lot 7 — Owner UAT**
  - [ ] Web app: open the chat, use "Move to…" for Right/Left/Center/Full, confirm each lands where expected and survives a reload.
  - [ ] Web app non-regression: one placement trigger is present and the Close button stays clickable.
  - [ ] Chrome extension: confirm the placement trigger is absent and the chat behaves as before.
  - [ ] Mobile viewport: confirm the bottom-sheet behavior and burger navigation are unchanged.

- [ ] **Lot 8 — Merge preparation**
  - [ ] Remove `BRANCH.md` before merge.
  - [ ] Mark PR #429 ready for review after owner UAT sign-off.
