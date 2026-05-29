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
  - `ui/src/**` (move `lib/core` into the package, re-point ALL importers to the bridge, delete the
    old `lib/core` — real extraction, no dual paths/shims)
  - `ui/package.json` (add the `@sentropic/cowork-bridge` workspace dependency)
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
- **BR41a-Q1** `acknowledge`: device registry — proto confirmed `POST /chrome-extension/tabs/register`
  rejects `source:"desktop_cowork"` (HTTP 400; `VALID_TAB_SOURCES` in
  `api/src/routes/api/chrome-extension.ts:46` + `TabSource` union in `tab-registry.ts:8`). Lot 3 will
  extend both spots (default: extend the existing registry). Note: registry is NOT required for the
  tool round-trip; it only drives UI targeting/presence.
- **BR41a-F1** `attention` (proto finding): the server auto-injects `tab_read`/`tab_action` into
  `localToolNames` when the user has a registered tab and the client did not send them
  (`chat-service.ts:2497-2503`). A desktop device must NOT be offered browser-DOM tools → Lot 3/4
  must gate tab-tool injection by device source/capabilities (or have the desktop client declare its
  own tool set and skip tab-tool injection for non-browser sources).
- **BR41a-F2** `attention` (proto finding): pausing generation for local tools requires
  `previous_response_id` (`packages/chat-core/src/runtime-finalization.ts:267`), i.e. an OpenAI
  Responses-style transport. The proto worked with `providerId:"openai"`. Lot 4 must pin the default
  cowork provider/model to one that returns a response id.
- **BR41a-Q2** `attention`: packaging — Node SEA vs pkg vs folder-zip fallback; decided at Lot 5.
- **BR41-Q1** `attention`: code-signing strategy (unsigned → SmartScreen/AV); likely deferred.
- **BR41a-EX1** `acknowledge` (Makefile): add `typecheck-cowork-bridge`, `test-cowork-bridge`,
  `build-cowork-bridge`, `pack-cowork-bridge`, `publish-cowork-bridge` (OIDC),
  `publish-cowork-bridge-token` (bootstrap fallback), mirroring the chat-ui targets line-for-line.
  Reason: validate + publish `@sentropic/cowork-bridge`; the in-situ refacto validates the package.
  Impact: additive targets only. Rollback: remove the targets.
- **BR41a-EX3** `acknowledge` (`.github/workflows/ci.yml`): add `cowork_bridge`/`cowork_bridge_publish`
  path filters, a `validate-cowork-bridge` job, and a steady-state OIDC `publish-cowork-bridge` job
  (fires on `github.ref == main`). Reason: trusted-publishing (OIDC) — the npm trusted publisher for
  `@sentropic/cowork-bridge` is configured (repo `rhanka/sentropic`, workflow `ci.yml`, `npm publish`),
  so the first and subsequent publishes happen via CI on merge to main, no token. Impact: additive CI
  jobs. Rollback: remove the added jobs/filters. Note: the token bootstrap path was abandoned (org
  enforces 2FA-and-disallow-tokens default for new packages; trusted publishing is the clean path).
- **BR41a-EX2** (`docker-compose*`) and **BR41a-EX4** (`api/drizzle/*.sql`) to be declared at Lot 5 /
  Lot 3 respectively if needed.

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
- [x] **Lot 0 — Baseline & constraints**
  - [x] Create/confirm isolated worktree `tmp/feat-cowork-desktop-tools`; verify branch.
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `PLAN.md`,
        `spec/SPEC_COWORK.md`, `spec/SPEC_CHROME_PLUGIN.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm env mapping + ports (slot 0: 9205 / 5405 / 1305) with `ENV` last.
  - [x] Confirm final package names (`@sentropic/cowork-bridge`, `@sentropic/cowork-desktop`).
  - [x] Validate scope boundaries; pre-declare `BR41a-EX1..EX4` as needed.

- [x] **Lot 1 — Proto spike (throwaway)**
  - [x] Minimal Node client: enroll via Bearer token (magic-link on a verified seed user — headless,
        no browser cookie needed), register in the presence registry, execute one `screen_capture`
        (stubbed image) driven from the Sentropic chat, return via `tool-results`.
  - [x] Success criterion MET: round-trip works end-to-end (reproduced twice) — `POST /chat/messages`
        with `localToolDefinitions:[screen_capture]` → SSE `status: awaiting_local_tool_results` with
        `pending_local_tool_calls` → `POST /chat/messages/:id/tool-results` → `resumed:true` → `done`
        with a non-empty assistant reply. `desktop_cowork` source rejected (used `chrome_plugin`
        fallback; registry not needed for the round-trip). See `## Feedback Loop` BR41a-Q1/F1/F2.
  - [x] Lot gate: result recorded; spike at `.proto-spike/cowork-proto.mjs` (untracked, to discard at
        Lot 2 start); env down, no stale services.

- [x] **Lot 2 — `@sentropic/cowork-bridge` + chrome-ext refactor**
  - [x] Create `packages/cowork-bridge/**`: extracted `ui/src/lib/core/*`; portable auth (token math +
        `extension-token`/`refresh` contracts behind `StorageAdapter` + injected `fetch`); local-tool
        protocol types + portable permission schema. (chat-ui SSE reuse deferred to Lot 4 — bridge has no chat-ui dep yet.)
  - [x] Re-pointed ALL importers (`ui/src/**`, `ui/chrome-ext/**`, `ui/vscode-ext/webview-entry.ts`,
        `ui/tests/stores/session.test.ts`) to `@sentropic/cowork-bridge/core`; DELETED old `ui/src/lib/core`
        (real extraction, no dual path). Chrome implements `StorageAdapter` with `chrome.storage`.
  - [x] Lot gate (all PASS, ports 9205/5405/1305, ENV=feat-cowork-desktop-tools):
    - [x] `make typecheck-ui` ✅ + `make lint-ui` ✅
    - [x] **Bridge**: `cowork-bridge` typecheck ✅ + vitest tests ✅ (`tests/{token,session-auth,permissions}.spec.ts`)
    - [x] **UI tests**: `make test-ui` ✅ (383 tests)
    - [x] **Non-regression**: `make build-ext-chrome` ✅ + `make build-ext-vscode` ✅
    - [x] `packages/cowork-bridge/package.json` at `0.1.0`. First publish needs one-shot bootstrap
          (`workflow_dispatch bootstrap_publish_target=cowork-bridge`, requires `github.ref==main`) +
          OIDC trusted publisher on npmjs.com — plumbing tracked as BR41a-EX1 (Makefile) + BR41a-EX3 (ci.yml).

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
