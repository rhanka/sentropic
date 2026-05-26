# Chore: BR-41 Cowork (documentation umbrella)

## Objective
Register and document the "Sentropic Cowork" effort: a portable, all-TypeScript Windows binary
(zip, no installer) exposing desktop tools (eyes/hands) to the Sentropic agent for agentic remote
control, reusing the Chrome-plugin enrollment and local-tool protocol via a published client bridge.
This branch is **documentation-only**: it adds the study `spec/SPEC_COWORK.md`, the BR-41a/b plan
files, and registers them in `PLAN.md`. No code changes.

## Pair scope
- **BR-41a `feat/cowork-desktop-tools`** — the foundation: extract+publish `@sentropic/cowork-bridge`
  (consolidating `ui/src/lib/core` + portable auth behind a StorageAdapter + the local-tool protocol
  types, reusing `@sentropic/chat-ui` for SSE) and refactor the Chrome extension to consume it; add a
  backend device-code enrollment flow + non-browser device registry; implement desktop tools
  (`screen_capture` = eyes, `input_action` = hands) with a per-tool consent model; ship the portable
  Windows zip; chat is driven from the Sentropic web app. Starts with a throwaway proto.
- **BR-41b `feat/cowork-local-webview`** — embed a third-party webview hosting `@sentropic/chat-ui`
  locally (mini-browser / workspaces) so the chat runs inside the binary. Depends on the bridge
  published by BR-41a.

## Orchestration Mode
- [x] **Multi-branch** (sequenced): BR-41b depends on the bridge published by BR-41a; they do not run
  in the same parallel wave.
- [ ] Mono-branch + cherry-pick
- Rationale: BR-41a establishes the published bridge + binary; BR-41b consumes it. Run BR-41a to
  completion (bridge published) before starting BR-41b.

## Wave & Port Allocation (branch nn = 41)
- Slot ports: API `9000 + (41*5) + slot` = `9205..9209`; UI `5200 + (41*5) + slot` = `5405..5409`;
  Maildev UI `1100 + (41*5) + slot` = `1305..1309`.
- BR-41a slot 0: `API_PORT=9205`, `UI_PORT=5405`, `MAILDEV_UI_PORT=1305`, worktree `tmp/feat-cowork-desktop-tools`.
- BR-41b slot 1: `API_PORT=9206`, `UI_PORT=5406`, `MAILDEV_UI_PORT=1306`, worktree `tmp/feat-cowork-local-webview`.
- Root dev/UAT stays on API `8787`, UI `5173`, Maildev `1080` (reserved for user).

## Dependency graph
- BR-41a — depends on `@sentropic/chat-ui` (existing) for the SSE StreamHub; otherwise independent.
- BR-41b — depends on BR-41a (the published `@sentropic/cowork-bridge` and the binary shell).

## Branch Scope Boundaries (this chore branch)
- **Allowed Paths**:
  - `spec/SPEC_COWORK.md`
  - `plan/41-BRANCH_chore-cowork.md`
  - `plan/41a-BRANCH_feat-cowork-desktop-tools.md`
  - `plan/41b-BRANCH_feat-cowork-local-webview.md`
  - `PLAN.md`
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, any `api/**`, `ui/**`,
  `packages/**`, `e2e/**`, other `plan/NN-BRANCH_*.md`.
- No code, no migration, no test changes in this branch.

## Feedback Loop (open framing questions — to resolve before/within implementation)
- **BR41a-Q1** `attention`: device-registry — extend `tab-registry.ts` to carry non-browser sources
  vs add a sibling `device-registry`. Default: extend. See BR-41a plan.
- **BR41a-Q2** `attention`: portable packaging — Node SEA vs pkg vs folder-zip fallback; validated at
  packaging lot. See BR-41a plan.
- **BR41-Q1** `attention`: code-signing strategy for the binary (unsigned → SmartScreen/AV warnings);
  likely deferred out of BR-41a. See `spec/SPEC_COWORK.md §12`.
- **BR41b-Q1** `attention`: webview engine (Neutralino / wry-sidecar / Electron / WebView2), decided
  at the start of BR-41b. See BR-41b plan.

## Closure
- [ ] Study spec `spec/SPEC_COWORK.md` added.
- [ ] Three plan files added (41 umbrella, 41a, 41b).
- [ ] `PLAN.md` updated (catalog rows + status addendum).
- [ ] PR created with `BRANCH.md` as body; merged via merge commit (squash/rebase disabled per §0).
- [ ] After merge: spawn BR-41a worktree, run the proto, resolve framing questions, begin Lot 0.
