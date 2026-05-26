# Feature: BR-41a Cowork Desktop Tools (portable Windows binary + client bridge)

## Objective
Ship the foundation of Sentropic Cowork: publish `@sentropic/cowork-bridge` (shared client core +
portable auth + local-tool protocol types, reusing `@sentropic/chat-ui` for SSE), refactor the
Chrome extension to consume it, add a backend device-code enrollment flow + non-browser device
registry, implement desktop tools (`screen_capture` = eyes, `input_action` = hands) with a per-tool
consent model, and package a portable Windows binary (zip) whose chat is driven from the Sentropic
web app. See `spec/SPEC_COWORK.md`.

## Scope / Guardrails
- Scope limited to: the new `packages/cowork-bridge/**`, the new binary package, the chrome-ext
  refactor, `ui/src/lib/core/**` re-pointing, backend device-code + registry, and the packaging
  pipeline.
- One migration max in `api/drizzle/*.sql` (device-code store, only if not in-memory).
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development in isolated worktree `tmp/feat-cowork-desktop-tools`.
- Automated tests on `ENV=test` / `ENV=e2e`, never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cowork-bridge/**` (new package)
  - `packages/cowork-desktop/**` (new binary package; final name confirmed at Lot 0)
  - `ui/chrome-ext/**` (refactor to consume the bridge — non-regression)
  - `ui/src/lib/core/**` (re-point imports to the bridge)
  - `api/src/routes/auth/**`, `api/src/services/**` (device-code flow + registry)
  - `api/src/routes/api/chrome-extension.ts` (registry source extension) or new device route
  - `spec/SPEC_COWORK.md`
  - `plan/41a-BRANCH_feat-cowork-desktop-tools.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.cursor/rules/**`
  - other `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` (new `build-desktop` / `package-desktop-windows` target) — requires `BR41a-EX1`
  - `docker-compose*.yml` (if a build service is needed) — requires `BR41a-EX2`
  - `.github/workflows/**` (cross-build + publish jobs, package-bump enforcement) — requires `BR41a-EX3`
  - `api/drizzle/*.sql` (device-code store, max 1 file) — requires `BR41a-EX4`
- **Exception process**: declare `BR41a-EXn` in `## Feedback Loop` with reason, impact, rollback
  before touching any conditional/forbidden path.

## Feedback Loop
- **BR41a-Q1** `attention`: device registry — extend `tab-registry.ts` to carry `source:
  "desktop_cowork"` vs add a sibling `device-registry`. Default: extend (one targeting surface).
- **BR41a-Q2** `attention`: packaging — Node SEA vs pkg vs folder-zip fallback; decided at Lot 5.
- **BR41-Q1** `attention`: code-signing strategy (unsigned → SmartScreen/AV); likely deferred.
- **BR41a-EX1..EX4** declared here when the corresponding conditional path is first touched.

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network nondeterminism as `flaky accepted`
  (at least one success on same commit + command). Never add timeouts. Record signature in this file.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [x] **Multi-branch** is the *pair* mode (BR-41a → BR-41b sequenced); BR-41a itself runs as a single
  branch with internal lots.
- Rationale: BR-41a is one coherent foundation; sub-agents may take orthogonal lots (bridge, backend
  device-code, desktop tools, packaging) in slots 0..4, integrated on this branch.

## UAT Management (in orchestration context)
- Mono-branch UAT on this branch after the relevant lots (chrome-ext non-regression; desktop tools).
- Execution flow: develop/test in `tmp/feat-cowork-desktop-tools`; push before UAT; user UAT from
  root workspace (`ENV=dev`); switch back after UAT.
- Env/ports (slot 0): `API_PORT=9205`, `UI_PORT=5405`, `MAILDEV_UI_PORT=1305`, `ENV=feat-cowork-desktop-tools`.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Create/confirm isolated worktree `tmp/feat-cowork-desktop-tools`; verify branch.
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `README.md`, `PLAN.md`,
        `spec/SPEC_COWORK.md`, `spec/SPEC_CHROME_PLUGIN.md`, `plan/BRANCH_TEMPLATE.md`.
  - [ ] Confirm env mapping + ports (slot 0: 9205 / 5405 / 1305) with `ENV` last.
  - [ ] Confirm final package names (`@sentropic/cowork-bridge`, `@sentropic/cowork-desktop`).
  - [ ] Validate scope boundaries; pre-declare `BR41a-EX1..EX4` as needed.

- [ ] **Lot 1 — Proto spike (throwaway)**
  - [ ] Minimal Node script: enroll via a manually pasted token, register `source: "desktop_cowork"`,
        execute one `screen_capture` driven from the Sentropic chat, return via `tool-results`.
  - [ ] Success criterion: backend accepts a non-browser device + desktop tool round-trips.
  - [ ] Lot gate: record proto result in this file; discard the spike code before Lot 2.

- [ ] **Lot 2 — `@sentropic/cowork-bridge` + chrome-ext refactor**
  - [ ] Create `packages/cowork-bridge/**`: extract `ui/src/lib/core/*`; portable auth (token math +
        `extension-token`/`refresh` contracts behind `StorageAdapter` + injected `fetch`); local-tool
        protocol types + portable permission schema; depend on `@sentropic/chat-ui`.
  - [ ] Re-point `ui/src/lib/core` consumers and refactor `ui/chrome-ext` to consume the bridge;
        Chrome implements `StorageAdapter` with `chrome.storage`.
  - [ ] Lot gate:
    - [ ] `make typecheck-ui` + `make lint-ui`
    - [ ] **UI tests**: bridge unit tests (`packages/cowork-bridge/tests/*.spec.ts`); update moved-module tests.
    - [ ] **Chrome-ext non-regression**: `make build-ext-chrome` + ext test suite green.
    - [ ] Bump `packages/cowork-bridge/package.json` (new package: bootstrap publish documented).

- [ ] **Lot 3 — Backend device-code enrollment + device registry**
  - [ ] `POST /auth/device/code` + `POST /auth/device/poll` (short-lived single-use codes, throttled
        poll), minting the token pair via `session-manager.createSession` with device name.
  - [ ] Minimal web "pair a device" page (enter `user_code` + confirm + device name).
  - [ ] Extend the presence registry for `source: "desktop_cowork"` (BR41a-Q1 default: extend).
  - [ ] Lot gate:
    - [ ] `make typecheck-api` + `make lint-api`
    - [ ] **API tests**: add `api/tests/api/auth-device-code.spec.ts`; update registry tests.
    - [ ] Sub-lot gate: `make test-api ENV=test-cowork-desktop-tools`

- [ ] **Lot 4 — Desktop tools (eyes + hands) + consent**
  - [ ] Implement `screen_capture` and `input_action` (`click`/`type`/`scroll`/`key`) as
        `ToolExecutor`s; pure-JS/prebuilt libs where possible.
  - [ ] Per-tool consent (`allow_once`/`allow_always`/`deny`, default deny) in the tray; revoke =
        `DELETE /auth/session` + clear tokens.
  - [ ] Replace the proto's paste-token with the device-code flow from Lot 3.
  - [ ] Lot gate:
    - [ ] `make typecheck` + `make lint` for the binary package
    - [ ] **Unit tests**: tool executors (mock capture/input), consent policy matching.

- [ ] **Lot 5 — Portable Windows binary packaging**
  - [ ] `esbuild` bundle; package via Node SEA (fallback pkg; fallback folder-zip) cross-built from
        Docker/Linux (`BR41a-EX1`/`EX2`).
  - [ ] New `make build-desktop` / `make package-desktop-windows`; output `ui/static/desktop/` + a
        download metadata endpoint analogous to the chrome-ext download.
  - [ ] CI cross-build/publish job mirroring the chrome-ext zip job (`BR41a-EX3`); bridge OIDC publish.
  - [ ] Lot gate: artifact builds in CI; smoke-launch on Windows (manual UAT below).

- [ ] **Lot N-2 — UAT**
  - [ ] Chrome plugin (non-regression): connect, run `tab_read`/`tab_action`, chat streaming unchanged.
  - [ ] Cowork binary (Windows): unzip, launch, device-code pairing, appears as chat target, grant
        consent, run `screen_capture` + `input_action` from the Sentropic chat.
  - [ ] Web app (non-regression): chat + existing tab targeting unaffected.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Update `spec/SPEC_COWORK.md` to match delivered behavior; cross-link from `SPEC_CHROME_PLUGIN.md`.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & lint (ui + api + packages).
  - [ ] Retest UI / API / E2E (copy Lot gates).
  - [ ] Bump every touched `packages/<pkg>/package.json` (CI `enforce-package-bump`).
  - [ ] Final gate: PR with `BRANCH.md` as body → branch CI green + UAT → remove `BRANCH.md` → push →
        merge via merge commit. Then unlock BR-41b.
