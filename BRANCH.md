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
  - `api/src/app.ts` (mount a permissive rate-limiter on `/auth/device/*` — BR41a-N1, accepted)
  - `api/tests/**` (device-code + registry + F1 gate tests)
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
- **BR41a-Q2** `acknowledge` — DECIDED (user, Lot 5): a single signable Windows `.exe` (pkg preferred for
  native-module support + Linux→Windows cross-compile; Node SEA fallback). Folder-zip is dropped (it has
  no Authenticode-signable artifact). The exe bundles the optional native libs (capture/input); native
  single-exe bundling risk accepted — if it proves infeasible the build STOPS and reports (no silent
  folder-zip fallback). Distributed via a download endpoint mirroring the chrome-ext one.
- **BR41-Q1** `acknowledge` — DECIDED (user): the `.exe` WILL be signed (in scope, BR-41a) with a
  **resold OV** code-signing cert (OV tier is sufficient — Airbus-internal deployment, no public
  SmartScreen-reputation need; EV would add nothing). Research summary: no free/Let's-Encrypt analogue
  for code signing; no cloud combo (Cloudflare/SCW/OVH) issues a Windows-trusted cert; cheapest public
  ≈ resold Sectigo OV ~$65/yr, Certum cloud ~$108/yr, Azure Trusted Signing ~$120/yr; the truly-free
  path is Airbus's internal PKI (declined for now). 2026 reality: OV certs are HSM-backed (cloud HSM
  like SimplySign/eSigner), NOT a local `.pfx`. The user will buy the resold OV cert **LATER**; the
  signing RUN is therefore **attendu** (user's scheduling). The packaging already ships a gated signing
  step (currently `osslsigncode` + `.pfx`, skipped when no cert); when the cloud-HSM cert is obtained,
  swap that step to **`jsign`** (cloud-HSM signing API). Until then the exe ships UNSIGNED (POC/UAT OK).
- **BR41a-Q5** `acknowledge` — DECIDED (user): publish `@sentropic/cowork-desktop` on npm (not
  `private`). DONE: `publish-cowork-desktop[-token]` make targets + CI OIDC `publish-cowork-desktop`
  job + `cowork_desktop_publish` filter (EX1/EX3) + `cowork-desktop` (and `cowork-bridge`) added to the
  `bootstrap_publish_target` enum + bootstrap steps in `ci.yml`. PUBLISH FLOW per package:
  - `@sentropic/cowork-bridge`: npm trusted publisher (OIDC) **already configured** via Playwright
    (repo `rhanka/sentropic`, `ci.yml`, `npm publish`) — its access page existed pre-publish (name was
    reserved by an earlier staged publish attempt). First publish can go via OIDC on merge to main.
  - `@sentropic/cowork-desktop`: its npm access page returns **Not Found** pre-publish (name never
    reserved/staged) → trusted publisher CANNOT be pre-configured. Per the documented flow, FIRST publish
    goes via the CI **bootstrap** (`workflow_dispatch bootstrap_publish_target=cowork-desktop`, uses the
    org `NPM_TOKEN` secret, `github.ref==main`), THEN attach its OIDC trusted publisher on npmjs.com
    (now-existing access page) for steady-state. So the desktop trusted-publisher is **attendu**
    (post-first-publish, at/after merge), NOT a pre-merge step.
  - Token hygiene: 4 short-lived `cowork-bridge-bootstrap*` granular tokens (all expire 2026-06-04) +
    the org `sentropic-bootstrap-publish` (do NOT touch). Conductor created 2 (`…ULEM`, `…Kf4W`); two
    `…br41a`/`…br41a-2` were not created in-session. Decision: let them auto-expire (2026-06-04).
- **BR41a-Q6** `acknowledge` (Lot 5 part A, single-exe method): single-exe is **feasible** — chose
  **@yao-pkg/pkg@6.9.0** (the maintained pkg fork), NOT Node SEA. esbuild@0.25.10 bundles the entry
  (`packaging/entry.mjs` → `src/index.ts` + bridge + chat-ui) to one CJS file with the native libs
  external; pkg cross-compiles it to `node24-win-x64` (one `cowork.exe`, 85.3 MB, verified `PE32+ x86-64
  MS Windows`). `make package-desktop-windows` ran green on Linux/Docker, unsigned (no cert), no SEA
  fallback needed. Native libs shipped via `npm install --os=win32 --cpu=x64` into a stage dir, copied
  into the zip under `node_modules/` next to the exe (`@nut-tree-fork/libnut-win32/.../libnut.node` +
  win CRT DLLs; `screenshot-desktop/lib/win32`). NOTE: `@nut-tree-fork/nut-js` hard-depends on
  `libnut-darwin` too, so a macOS `.node` also lands in the zip (harmless dead weight on Windows; not
  loaded). RISK: the exe is built on Linux and NOT executed here — the runtime dynamic `import()` of the
  win32 native modules must be validated on a real Windows host at UAT (Lot N-2). The signing RUN with
  the user's OV `.pfx` is **attendu** (conductor runs once cert+password provided; step is wired+gated).
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
- **BR41a-Q3** `acknowledge` (Lot 3, device-code store): chose IN-MEMORY store with TTL
  (`api/src/services/device-code-store.ts`, mirrors `tab-registry.ts`) per launch-packet default →
  **EX4 NOT needed** (no DB migration). Single-use codes, 10-min TTL, `slow_down` throttle.
- **BR41a-N1** `acknowledge` (Lot 3, scope note on `api/src/app.ts`): added one additive
  most-specific-first rate-limiter line `app.use('/api/v1/auth/device/*', authSessionRateLimiter)`
  before the general `/auth/*` limiter. Reason: device poll runs at the RFC8628 `interval` (5s) while
  pending; the general auth limiter (10 req/15 min) would make polling unusable. Impact: additive,
  reuses the existing permissive session limiter; per-code throttle still enforced in the store.
  `app.ts` is not in the explicit Allowed Paths list — reviewed and ACCEPTED by conductor (minimal,
  required, reuses existing limiter, follows the surrounding login/register/magic-link pattern);
  `api/src/app.ts` added to Allowed Paths. Rollback: remove the single line.
- **BR41a-Q4** `acknowledge` — RESOLVED by conductor (extends BR41a-EX1). Added `typecheck-cowork-desktop`,
  `test-cowork-desktop`, `build-cowork-desktop`, `pack-cowork-desktop` make targets (mirror cowork-bridge;
  they symlink `@sentropic/cowork-bridge` + `@sentropic/chat-ui` + `@types` into the package node_modules
  for standalone tsc/vitest) + a CI `validate-cowork-desktop` job + `cowork_desktop` path filter (EX3).
  Conductor ran them: typecheck ✅, tests 37/37 ✅, build+pack ✅ (and fixed the DESKTOP_ORIGIN bug they
  surfaced). The desktop binary's PUBLISH (npm publish vs `private:true` + Windows-zip distribution) is
  deferred to **Lot 5** (packaging) — no `publish-cowork-desktop`/token target added yet; root lockfile
  regenerated to include the package (`make lock-root`). Rollback: remove the targets/jobs.
- **BR41a-Q7** `acknowledge` (Lot 5C, two user decisions): (1) gate ALL THREE Settings download cards
  (chrome+vscode+cowork) behind `{#if isAdmin()}` — today they are visible to every authenticated user,
  a gap fixed here for all three together. (2) Prerelease admin channel — the branch-built unsigned exe
  is served via Sentropic as a "prerelease" build (downloadable now for UAT), DISTINCT from the official
  "release" build; an admin chooses which channel is exposed. Persisted as a GLOBAL `settings` row
  (`cowork_desktop.channel`, default `release`) via the existing `settingsService`; release/prerelease
  URLs from `COWORK_DESKTOP_DOWNLOAD_URL` / `COWORK_DESKTOP_PRERELEASE_URL`.

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network nondeterminism as `flaky accepted`
  (at least one success on same commit + command). Never add timeouts. Record signature in this file.
- **AI flaky accepted (CI, PR #192 run `26699459726`)** — `tests/ai/chat-tools.test.ts > should call
  update_initiative_field and update database` (`Test timed out in 15000ms`) and `> should handle
  web_extract with array of URLs correctly` (`Test timed out in 30000ms`), plus a `chat_stream_events`
  FK race (`violates chat_stream_events_message_id_chat_messages_id_fk`). Command: CI `make test-api-ai`
  shard `(ai, chat-tools,...)`. Non-systematic: **re-run of the same failed shard on the SAME commit
  passed** (`gh run rerun --failed` → shard `success`, overall run `success`). On the allowlist
  (`api/tests/ai/**`); the branch does not touch `update_initiative_field`/`web_extract`/chat-tools
  logic. No timeout inflation applied. **User sign-off required before merge** (per acceptance rule).
- **Local-only env artifact (accepted, not a branch regression)** — `tests/api/workspace-types.test.ts >
  creates a workspace with explicit type` failed locally with `Error: Hook timed out in 10000ms.` in the
  `beforeEach` (cold-start `importApp()` + 2 `createAuthenticatedUser`, first test of the file). Command:
  `make test-api SCOPE=tests/api/workspace-types.test.ts ENV=test-cowork-desktop-tools`. Root cause:
  machine contention (dev stack `ENV=dev` + concurrent branch test stacks) inflated cold-start transform
  (~8-9s vs ~3-5s) past the 10s hook on this loaded host. NOT a branch regression — the file/setup
  (`workspace-types.test.ts`, `auth-helper`, `importApp`) are unchanged by this branch, and **CI is green
  on the branch**: PR #192 run `26619930864` — all `test-api-unit-integration` shards (incl. `endpoints
  1-4`) `success`. No timeout inflation applied. Signature: `Hook timed out in 10000ms` at
  `workspace-types.test.ts:27:3`.

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

- [x] **Lot 3 — Backend device-code enrollment + device registry**
  - [x] `POST /auth/device/code` + `POST /auth/device/poll` + `POST /auth/device/approve` (auth);
        short-lived (10 min) single-use codes, throttled poll (`slow_down`), minting the token pair
        via `session-manager.createSession` with the approving user's role + device name. In-memory
        store with TTL (`device-code-store.ts`, mirrors `tab-registry.ts`) — NO DB migration, EX4 NOT
        needed. New `deviceRouter` mounted in `auth/index.ts`; permissive rate-limiter line added in
        `app.ts` for `/auth/device/*` (device poll is 5s-interval; general auth limiter is 10/15min).
  - [x] Minimal web "pair a device" page (enter `user_code` + confirm + device name) at
        `ui/src/routes/auth/devices/pair/+page.svelte` (auto-protected via `/auth/devices/*`); calls
        `POST /auth/device/approve`; reuses existing components/styles; i18n FR+EN under
        `auth.devices.pair`; linked from the existing `/auth/devices` page.
  - [x] Extend the presence registry for `source: "desktop_cowork"` (BR41a-Q1 default: extend).
        `VALID_TAB_SOURCES` + `TabSource` union now accept `desktop_cowork`; `device_<uuid>` id pattern;
        `isBrowserSource()` helper added. BR41a-F1 gate applied in `chat-service.ts` (auto-injection of
        `tab_read`/`tab_action` filtered to browser sources only).
  - [x] Lot gate:
    - [x] `make typecheck-api` ✅ (exit 0) + `make lint-api` ✅ (0 errors; 178 pre-existing warnings
          in untouched files — no new warnings from device-code-store.ts / device.ts).
    - [x] **API tests**: added `api/tests/api/auth-device-code.spec.ts` (9 cases) +
          `api/tests/api/chrome-extension-register.test.ts` (3 cases) + unit
          `tests/unit/device-code-store.test.ts` (9 cases); updated `tests/unit/tab-registry.test.ts`
          (+desktop_cowork +isBrowserSource) and `tests/unit/chat-service-tab-tools.test.ts` (+2 F1 cases).
    - [x] Sub-lot gate (ENV=test-cowork-desktop-tools): unit 36/36 ✅ (3 files); endpoints 12/12 ✅
          (2 files).
    - [x] Conductor full gate: `typecheck-api`/`lint-api`/`typecheck-ui`/`lint-ui` ✅ local; full
          `make test-api` + UI typecheck/lint green on **CI** (PR #192, all `test-api` shards `success`).
          One local cold-start timeout in unrelated `workspace-types` = machine-contention artifact
          (documented under `## AI Flaky tests`, CI proves it green).

- [x] **Lot 4 — Desktop tools (eyes + hands) + consent**
  - [x] Created `packages/cowork-desktop/**`: package skeleton (package.json/tsconfig/LICENSE/README),
        a `DesktopCapabilityProvider` seam (`captureScreen`/`mouseClick`/`type`/`scroll`/`key`) with a
        headless mock provider (all tests) + a dynamic-import Windows provider (`screenshot-desktop` +
        `@nut-tree-fork/nut-js` as **optionalDependencies**; loads cleanly on Linux, throws
        `CapabilityUnavailableError` when native libs absent), a Node file-backed `StorageAdapter` +
        `ConsentStore`, the device-code enrollment client, the presence registry client, the runner,
        and a thin `bin/cowork.mjs`.
  - [x] Implemented `screen_capture` (eyes) and `input_action` (`click`/`type`/`scroll`/`key`) (hands)
        as bridge `ToolExecutor`s fed by the `DesktopCapabilityProvider` (no native libs at this lot;
        real Windows capture/input verified at UAT — Lot N-2).
  - [x] Per-tool consent (`allow_once`/`allow_always`/`deny`, default DENY) over the bridge permission
        schema; persisted via the Node `StorageAdapter`; a consent-gating dispatcher
        (`runDesktopToolCall`) returns structured denied/needs-consent results. Revoke clears persisted
        consent (`ConsentManager.revokeAll`); session revoke (`DELETE /auth/session`) is the bridge
        `SessionAuthClient.logout`. Tray UI deferred to Lot 5 (model + headless `ConsentPrompt` hook).
  - [x] Device-code enrollment client (`DeviceCodeClient`) drives Lot 3 `/auth/device/code` + `/poll`
        (respects `interval` + `slow_down`), stores the token pair via the `StorageAdapter`; refresh via
        the bridge auth logic. Replaces the proto's pasted token. Default cowork provider/model pin
        (BR41a-F2) is wired at the chat-request layer in Lot 5 packaging (runner is provider-agnostic).
  - [x] **BR41a-F1 gate**: the desktop runner advertises ONLY `screen_capture`/`input_action` and the
        Lot 3 `chat-service.ts` browser-only auto-injection means desktop devices are never offered
        `tab_read`/`tab_action`; the runner also ignores any non-desktop pending tool call.
  - [x] Lot gate (conductor added the `*-cowork-desktop` make targets per BR41a-Q4 → resolved):
    - [x] `make typecheck-cowork-desktop` ✅ (exit 0). Build+pack ✅ (`make pack-cowork-desktop` →
          `@sentropic/cowork-desktop@0.1.0`). Targets symlink `@sentropic/cowork-bridge` + `chat-ui` +
          `@types` into the package node_modules for standalone tsc/vitest.
    - [x] **Unit tests**: `make test-cowork-desktop` ✅ **37/37** (6 files: consent, tools,
          device-code-client, file-store, registry-client, cowork-runner) — mock-based, headless.
    - [x] **Bug found+fixed during conductor verification**: `DESKTOP_ORIGIN` was `'desktop'` (single
          label) → the bridge `isValidHostname` rejects single-label hosts → `normalizeEntry` dropped
          every persisted consent entry → all consent lookups fell back to default-deny (8 failing
          tests). Fixed to `'desktop.cowork'` (multi-label). All tests green after the fix.

- [ ] **Lot 5 — Portable Windows binary packaging**
  - [x] `esbuild` bundle (`packaging/esbuild.config.mjs` → 35kb CJS, native libs external) + single
        signable `.exe` via **@yao-pkg/pkg** (`node24-win-x64`, 85.3 MB PE32+ console exe) cross-built
        from Docker/Linux. Win-x64 native prebuilds fetched on Linux via `npm install --os=win32
        --cpu=x64` and shipped under `node_modules/` next to the exe. `osslsigncode` Authenticode step
        gated on `COWORK_SIGN_PFX`+`COWORK_SIGN_PASS` (skipped+warned if absent). See BR41a-Q6.
  - [x] New `make package-desktop-windows`; output `ui/static/cowork-desktop/` (gitignored, mirrors
        chrome-ext): `cowork.exe` + `sentropic-cowork-windows-x64.zip` + `cowork-desktop-metadata.json`.
        Download metadata endpoint `GET /cowork-desktop/download` (`api/src/routes/api/cowork-desktop.ts`).
  - [ ] CI cross-build/publish job mirroring the chrome-ext zip job (`BR41a-EX3`); bridge OIDC publish.
        (Conductor scope per Lot 5 launch packet — this sub-agent delivered only the EXE + download.)
  - [ ] Lot gate: artifact builds in CI; smoke-launch on Windows (manual UAT below). Local
        `make package-desktop-windows` ✅ (unsigned exe produced; signing skipped). Windows execution +
        the signing RUN with a real `.pfx` = UAT/attendu.

- [x] **Lot 5C — Admin-gate downloads + cowork prerelease channel** (BR41a-Q7)
  - [x] Gate the 3 Settings download cards (chrome+cowork+vscode) behind `{#if isAdmin()}`
        (`ui/src/routes/settings/+page.svelte`); non-admins no longer see them. Download-metadata
        loads moved inside the `if (isAdmin())` onMount branch (no wasted fetch for non-admins).
  - [x] Env: add `COWORK_DESKTOP_PRERELEASE_URL` + `COWORK_DESKTOP_PRERELEASE_VERSION`
        (`api/src/config/env.ts`); reuse `COWORK_DESKTOP_DOWNLOAD_URL` as the RELEASE url.
  - [x] Persist active channel as a GLOBAL `settings` row `cowork_desktop.channel`
        (default `release`) via the existing `settingsService` (no new table, no migration).
  - [x] `GET /cowork-desktop/download` returns `{ channel, version, source, downloadUrl }` for the
        active channel; admin-only `GET/PUT /cowork-desktop/channel` guarded by `requireAdmin`.
  - [x] UI: admin channel toggle in the cowork card (PUT then refetch, channel derived from the
        download metadata); i18n fr+en under `settings.coworkDesktop.channel.*`.
  - [x] Lot gate: `typecheck-api` ✅ / `lint-api` ✅ (0 errors) / `typecheck-ui` ✅ / `lint-ui` ✅;
        scoped api test `tests/api/cowork-desktop-download.test.ts` (7 cases) + `make test-ui` —
        see Checks. NOTE: repo-wide `make format-check` is broken by a pre-existing invalid
        `ui/.prettierrc` `svelteSortOrder: "scripts-markup-styles"` (rejected by prettier-plugin-svelte
        v3); CI does not run `format-check`, so this is not a merge gate. New code matches repo style.

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
