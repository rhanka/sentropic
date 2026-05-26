# Feature: BR-41b Cowork Local Webview (mini-browser / workspaces)

## Objective
Extend the Sentropic Cowork binary with a local third-party webview that hosts the existing chat UI
(`@sentropic/chat-ui`) so the chat runs inside the binary (a mini-browser), and lay the ground for
Sentropic workspaces in that webview. Depends on the `@sentropic/cowork-bridge` and binary shell
published by BR-41a. See `spec/SPEC_COWORK.md`.

## Scope / Guardrails
- Scope limited to: the binary package's webview host, serving `@sentropic/chat-ui` as static assets,
  wiring the bridge (ApiClient / AuthBridge / NavigationAdapter) into the webview, and packaging the
  chosen webview engine into the portable zip.
- No backend protocol changes expected (reuses BR-41a enrollment, registry, tools, SSE).
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development in isolated worktree `tmp/feat-cowork-local-webview`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cowork-desktop/**` (webview host + asset wiring; name from BR-41a)
  - `packages/cowork-bridge/**` (only if a thin webview-host adapter must be added)
  - `spec/SPEC_COWORK.md`
  - `plan/41b-BRANCH_feat-cowork-local-webview.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
  - `api/**`, `e2e/**`
  - other `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` / `docker-compose*.yml` (only if the webview engine changes the packaging) — `BR41b-EX1`
  - `.github/workflows/**` (if the cross-build job needs webview-engine deps) — `BR41b-EX2`
  - `ui/**` (only if `@sentropic/chat-ui` needs a host-mode hook to run in this webview) — `BR41b-EX3`
- **Exception process**: declare `BR41b-EXn` in `## Feedback Loop` with reason, impact, rollback.

## Feedback Loop
- **BR41b-Q1** `attention`: webview engine — Neutralino (small, web runtime) vs wry/Tao sidecar
  (Rust, embedded) vs Electron (turnkey, heavy) vs WebView2 host. Trades portability/zip-size vs
  effort; decided at Lot 0.
- **BR41b-Q2** `attention`: how `@sentropic/chat-ui` is served and which host-mode/adapters it needs
  to run outside SvelteKit and the Chrome content-script (props injection vs a small host shim).

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network nondeterminism (one success on same
  commit + command). Never add timeouts. Record signature in this file.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single coherent capability on top of BR-41a)
- [ ] **Multi-branch**
- Rationale: one feature (local webview host) layered on the published bridge + binary.

## UAT Management (in orchestration context)
- Mono-branch UAT on this branch after the webview lot (Windows).
- Execution flow: develop/test in `tmp/feat-cowork-local-webview`; push before UAT; user UAT from
  root workspace (`ENV=dev`); switch back after UAT.
- Env/ports (slot 1): `API_PORT=9206`, `UI_PORT=5406`, `MAILDEV_UI_PORT=1306`, `ENV=feat-cowork-local-webview`.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `PLAN.md`, `spec/SPEC_COWORK.md`, BR-41a plan,
        `plan/BRANCH_TEMPLATE.md`.
  - [ ] Confirm `@sentropic/cowork-bridge` is published and the binary shell exists (BR-41a merged).
  - [ ] Create/confirm worktree `tmp/feat-cowork-local-webview`; verify branch; ports 9206/5406/1306.
  - [ ] Decide webview engine (BR41b-Q1) and chat-ui serving strategy (BR41b-Q2).

- [ ] **Lot 1 — Webview host hosting `@sentropic/chat-ui`**
  - [ ] Embed the chosen webview engine; serve the chat-ui bundle as local static assets.
  - [ ] Inject the bridge (ApiClient with Bearer token, AuthBridge from stored session,
        NavigationAdapter for external links, Node SSE factory) into the webview.
  - [ ] Reuse BR-41a enrollment/registry/tools so the in-binary chat can drive the desktop tools.
  - [ ] Lot gate:
    - [ ] `make typecheck` + `make lint` for the binary package
    - [ ] **Unit tests**: bridge injection wiring; webview host bootstrap.

- [ ] **Lot 2 — Packaging the webview into the portable zip**
  - [ ] Bundle the webview engine into the portable Windows zip (engine deps; `BR41b-EX1`/`EX2` if the
        packaging or CI changes).
  - [ ] Lot gate: artifact builds in CI; zip size recorded; smoke-launch (manual UAT below).

- [ ] **Lot N-2 — UAT**
  - [ ] Cowork binary (Windows): launch, the local webview shows the Sentropic chat, send a message,
        SSE streaming renders, run a desktop tool from the in-binary chat.
  - [ ] Non-regression: BR-41a flows (pairing, web-app-driven tools) still work.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Update `spec/SPEC_COWORK.md` (webview engine, serving model, workspaces direction).

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & lint.
  - [ ] Retest (copy Lot gates) + Windows smoke.
  - [ ] Bump every touched `packages/<pkg>/package.json` (CI `enforce-package-bump`).
  - [ ] Final gate: PR with `BRANCH.md` as body → CI green + UAT → remove `BRANCH.md` → push → merge
        via merge commit.
