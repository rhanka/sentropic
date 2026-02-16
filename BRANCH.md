# Feature: Chrome Extension Plugin

## Objective
Build a Chrome extension (Manifest V3) that embeds the ChatWidget into any web page via Shadow DOM, allowing users to chat with the Top AI Ideas assistant and leverage local Chrome tools (tab reading, screenshots, click automation) alongside server-side tools.

## Scope / Guardrails
- Scope limited to: abstraction layer (`ui/src/lib/core/`), ChatWidget/ChatPanel refactoring, Chrome extension skeleton (`ui/chrome-ext/`), local Chrome tools, minimal API evolution for local tool support.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-chrome-plugin` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Questions / Notes
- Shadow DOM + Svelte 5: portals and modals may need workarounds. Handle with `{ target: document.body }` fallback if needed.
- API evolution for `localToolDefinitions` and `tool-results` endpoint: keep backward-compatible (optional fields only).
- The `git worktree` approach is used instead of `git clone` for the isolated workspace (faster, shared objects).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: Single feature (Chrome extension), all changes are interdependent (abstraction layer required for the extension), single branch is sufficient.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-chrome-plugin`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/feat-chrome-plugin` after UAT.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline & constraints**
  - [x] Read the relevant `.mdc` files and `README.md`.
  - [x] Create/confirm isolated worktree `tmp/feat-chrome-plugin` and run development there.
  - [x] Capture Makefile targets needed for debug/testing.
  - [x] Define environment mapping (`dev`, `test`, `e2e`) and ports for this branch.
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [x] Confirm scope and guardrails.
  - [x] Add `spec/SPEC_CHROME_PLUGIN.md` (initial draft).

- [x] **Lot 1 — Abstraction layer (ui/src/lib/core/)**
  - [x] Create `ui/src/lib/core/context-provider.ts` (ContextProvider interface + SvelteKit impl + Extension impl)
  - [x] Create `ui/src/lib/core/api-client.ts` (configurable ApiClient without `$app` deps)
  - [x] Create `ui/src/lib/core/auth-bridge.ts` (AuthBridge interface)
  - [x] Create `ui/src/lib/core/navigation-adapter.ts` (NavigationAdapter interface)
  - [x] Lot gate: `make typecheck-ui ENV=test` + `make lint-ui ENV=test` (passed, zero new errors)

- [x] **Lot 2 — ChatWidget & ChatPanel refactoring**
  - [x] Refactor `ChatWidget.svelte`: replace `$app/stores` (page) and `$app/environment` (browser) with `ContextProvider`
  - [x] Refactor `ChatPanel.svelte`: N/A — no `$app` imports found (already decoupled)
  - [x] Refactor `session.ts`: decouple `goto` via `NavigationAdapter`
  - [x] Refactor `streamHub.ts`: accept injected `baseUrl` via `getApiBaseUrl()` fallback
  - [x] Verify non-regression: typecheck + lint gates pass (existing web app behavior preserved via fallbacks)
  - [x] Lot gate: `make typecheck-ui ENV=test` + `make lint-ui ENV=test` (passed)
  - [x] **UAT planning update**: defer Web App non-regression UAT from Lot 2 to Lot 3 integrated UAT (plugin + app in the same cycle).

- [x] **Lot 3 — Chrome extension skeleton + behavior parity**
  - [x] Create `ui/chrome-ext/manifest.json` (Manifest V3)
  - [x] Create `ui/chrome-ext/content.ts` (Shadow DOM bootstrap + ChatWidget mount)
  - [x] Create `ui/chrome-ext/background.ts` (service worker skeleton)
  - [x] Create `ui/chrome-ext/popup.html` + `popup.ts` (API URL config)
  - [x] Create `ui/chrome-ext/sidepanel.html` + `sidepanel.ts` (side panel placeholder)
  - [x] Create `ui/chrome-ext/vite.config.ext.ts` (multi-entry Vite build)
  - [x] Create `ui/chrome-ext/chatwidget-entry.ts` (Svelte mount with extension providers)
  - [x] Add Makefile targets: `build-ext`, `dev-ext`, `package-ext`
  - [x] Add `package.json` scripts: `build:ext`, `dev:ext`
  - [x] Create extension icons (placeholder) (via copy script)
  - [x] Lot gate: `make build-ext ENV=test` succeeds
  - [x] **Lot 3A — Extension loading/packaging (validated)**
    - [x] Fix manifest popup/sidepanel paths to built files (`chrome-ext/popup.html`, `chrome-ext/sidepanel.html`)
    - [x] Ensure `make build-ext` produces a directly loadable `ui/chrome-ext/dist` output
    - [x] Add build checks in `make build-ext` for required files (`manifest.json`, `content.js`, popup/sidepanel html)
    - [x] Add ownership normalization in `make build-ext` so unpacked load does not fail on file permissions
    - [x] Ignore extension build artifacts in Git (`ui/chrome-ext/dist/`) and stop tracking `dist` files
    - [x] **Partial UAT Lot 3A (root workspace)**
      - [x] **Build**: Run `make build-ext`. Verification: `✅ Extension built` and files in `ui/chrome-ext/dist/`.
      - [x] **Install**: Open `chrome://extensions`, enable "Developer mode", click "Load unpacked", select `ui/chrome-ext/dist` folder.
      - [x] **Verify loadability**: Manifest is accepted by Chrome (no load blocker on manifest/content script).
  - [x] **Lot 3B — ChatWidget/ChatPanel exact UX parity (mandatory before Lot 4A)**
    - [x] Remove temporary fallback UI from `ui/chrome-ext/content.ts` (no custom `AI` button, no ad-hoc popup panel)
    - [x] Mount the existing ChatWidget implementation only (same bubble icon/component and same UI contract as web app)
    - [x] Keep same opening/closing behavior and anchoring (no unexpected move/jump when opening panel)
    - [x] Keep same visual style/tokens as existing components (no custom inline style system for widget/panel)
    - [x] Keep same toasts behavior and placement as existing ChatWidget/ChatPanel flow
    - [x] Preserve context + streaming behavior through existing stores/adapters (no UX regression introduced by extension mount)
    - [x] Fix dynamic import mount contract: `chatwidget.js` now registers a global mount fallback and `content.ts` resolves `mount` from export/default/global.
    - [x] Lot gate: `make typecheck-ui ENV=test` + `make lint-ui ENV=test`
    - [x] Ready for partial UAT Lot 3B on root workspace (`.`) with current branch state.
    - [x] **Partial UAT Lot 3B — Chrome Extension parity (execute on root workspace `~/src/top-ai-ideas-fullstack`)**
      - [x] **Prepare extension build**: Run `make build-ext` from root workspace (`.`).
      - [x] **Reload extension**: In `chrome://extensions`, click "Reload" on unpacked extension (or load `ui/chrome-ext/dist` again if needed).
      - [x] **Bubble parity (Chrome page)**: Same chat bubble icon as web app (not text `AI`), same default collapsed state.
      - [x] **Open parity (Chrome page)**: Clicking bubble opens the same panel structure/actions as existing widget.
      - [x] **Close parity (Chrome page)**: Closing/minimizing restores same collapsed behavior and button placement.
      - [x] **Position parity (Chrome page)**: Bubble remains anchored in expected corner before/after toggles (no drift/jump).
      - [x] **Style parity (Chrome page)**: Header/body/input/actions/toasts match existing ChatWidget/ChatPanel visual system, except font-family parity.
      - [x] **Font parity (Chrome page)**: Same font-family token as web app in extension context (tracked in Lot 3C).
      - [x] **Behavior parity (Chrome page)**: Send one message and verify streaming response behavior remains consistent.
      - [x] **No runtime errors (Chrome page)**: No extension content-script error in extension page/console during open-close-send flow.
    - [x] **Partial UAT Lot 3B — Web App non-regression (execute on root workspace `~/src/top-ai-ideas-fullstack`)**
      - [x] **Auth**: Logout and login back in (session navigation behavior unchanged).
      - [x] **Chat open**: Open the global chat in web app and verify initial collapsed/expanded behavior.
      - [x] **Context**: Navigate to folder/usecase and verify chat context is still correct.
      - [x] **Streaming**: Send a message and verify streaming response behavior is unchanged.
      - [x] **Toasts**: Trigger one success/error feedback path and verify toast style/placement unchanged in web app.
  - [x] **UAT: Integrated App + Chrome Extension (close Lot 3, root workspace only)**
    - [x] Confirm both partial checklists are completed: `3B Chrome Extension parity` + `3B Web App non-regression`.
    - [x] Confirm no cross-regression between extension behavior and web app behavior in the same UAT cycle.
    - [x] Close Lot 3 only after Lot 3C font parity is validated.

- [x] **Lot 3C — Runtime parity hardening (font, side panel, host exclusion)**
  - [x] Define a single shared font token (e.g. `--chat-font-family`) used by both web app and extension widget.
  - [x] Apply the shared font token at ChatWidget root level to avoid host page font override in Shadow DOM.
  - [x] Replace extension in-page docked behavior with official Chrome Side Panel behavior for docked mode.
  - [x] Implement state handoff between floating bubble and side panel (active tab, draft, current session, open/close state).
  - [x] Re-enable floating/docked switch both ways (bubble overlay ↔ Chrome side panel) from the same existing ChatWidget control.
  - [x] Hide empty burger action in side panel host (no orphan menu entry).
  - [x] Fix side panel chat layout parity (`min-h-0` + flex column) to restore bottom composer behavior and internal scroll.
  - [x] Initialize auth session in extension mount path and allow `chrome-extension://*` CORS origin for API/SSE calls.
  - [x] Add extension activation guard on Top AI Ideas app domains:
    - [x] `manifest.json` `exclude_matches` for localhost/prod app domains.
    - [x] Runtime hostname denylist fallback in `content.ts`.
  - [x] Lot gate: `make typecheck-ui API_PORT=8792 UI_PORT=5177 MAILDEV_UI_PORT=1082 ENV=feat-chrome-plugin` + `make lint-ui API_PORT=8792 UI_PORT=5177 MAILDEV_UI_PORT=1082 ENV=feat-chrome-plugin` + `make typecheck-api API_PORT=8792 UI_PORT=5177 MAILDEV_UI_PORT=1082 ENV=feat-chrome-plugin` + `make lint-api API_PORT=8792 UI_PORT=5177 MAILDEV_UI_PORT=1082 ENV=feat-chrome-plugin` + `make build-ext API_PORT=8792 UI_PORT=5177 MAILDEV_UI_PORT=1082 ENV=feat-chrome-plugin`
  - [x] Ready for partial UAT Lot 3C on root workspace (`.`).
  - [x] **Partial UAT Lot 3C (root workspace `~/src/top-ai-ideas-fullstack`)**
    - [x] Run `make build-ext`, reload unpacked extension.
    - [x] Validate font parity between web app widget and extension widget.
    - [x] Validate side panel mode keeps same component style/behavior as floating mode.
    - [x] Validate side panel critical regressions are fixed: overlay/panel switch button visible and functional, streaming works, composer stays at bottom, messages list is scrollable, no empty burger action.
    - [x] Validate no content-script injection on Top AI Ideas app domains (`localhost`, `127.0.0.1`, prod domain list).

- [x] **Lot 4A — Extension configuration and mandatory API connectivity (UAT/PROD)**
  - [x] Fix floating overlay ChatWidget API connectivity (`initializeSession` + send/stream) so behavior matches side panel and no `Failed to fetch` remains. (implemented via background proxy + overlay stream polling fallback)
  - [x] Add extension runtime profiles: `UAT`, `PROD` (API base URL mandatory, app base URL, optional WS base URL).
  - [x] Add profile/config UI (popup or options page) with validation and persistence.
  - [x] Implement extension background fetch proxy for overlay API calls to avoid page-origin CORS/mixed-content failures.
  - [x] Ensure both `UAT` and `PROD` profiles are API-connected (no disconnected mock-only flow).
  - [x] Add API connectivity test action (`/api/v1/health`) and visible status in extension UI.
  - [x] Wire ChatWidget API client to extension profile config with clear error states when config is invalid.
  - [x] Lot gate: `make typecheck-ui API_PORT=8892 UI_PORT=5187 MAILDEV_UI_PORT=1092 ENV=test-chrome-plugin` + `make lint-ui API_PORT=8892 UI_PORT=5187 MAILDEV_UI_PORT=1092 ENV=test-chrome-plugin`
  - [x] **Partial UAT Lot 4A (root workspace `~/src/top-ai-ideas-fullstack`, validated with accepted 4B follow-ups)**
    - [x] Switch profile `UAT`/`PROD` and verify endpoint persistence. (execution deferred by decision; covered by dedicated 4B config-menu UAT)
    - [x] Validate connectivity status and chat send/streaming in both profiles.
    - [x] Validate floating overlay widget can initialize session and chat send/stream without `Failed to initialize session` / `Failed to fetch`.
    - [x] Validate failure mode when endpoint is invalid (clear error feedback confirmed; UI placement refinement deferred to 4B)

- [ ] **Lot 4B — Extension auth model (dedicated token, no passive WebAuthn prompts)**
  - [x] Add an in-app configuration menu for extension endpoint/profile selection (UAT/PROD) and persist it as the primary user-facing config surface. (implemented in ChatWidget header, pending UAT)
  - [x] Move chat connectivity/runtime errors to the end of the conversation flow (bottom, latest message area), not at top. (implemented, pending UAT)
  - [ ] Design and implement a dedicated extension auth token flow (access token + renewal strategy).
  - [ ] Ensure auth is started only from explicit extension user action (never passive bootstrap from content script).
  - [ ] Prevent third-party-page WebAuthn side effects (no unexpected local-device permission prompts).
  - [ ] Add secure token storage and logout/revoke path in extension context.
  - [ ] Document compatibility path with future local/remote WS delegation.
  - [x] Sub-lot gate (4B config + error UX): `make typecheck-ui API_PORT=8892 UI_PORT=5187 MAILDEV_UI_PORT=1092 ENV=test-chrome-plugin` + `make lint-ui API_PORT=8892 UI_PORT=5187 MAILDEV_UI_PORT=1092 ENV=test-chrome-plugin` + `make build-ext API_PORT=8892 UI_PORT=5187 MAILDEV_UI_PORT=1092 ENV=test-chrome-plugin`
  - [ ] Lot gate: `make typecheck-ui ENV=test` + `make lint-ui ENV=test`
  - [ ] **Partial UAT Lot 4B (root workspace `~/src/top-ai-ideas-fullstack`)**
    - [ ] Validate in-chat endpoint configuration menu (overlay + side panel): profile switch (`UAT`/`PROD`), endpoint save, API health test, persistence after extension reload.
    - [ ] Validate chat API failure feedback appears at the bottom/latest message area (not at the top of conversation).
    - [ ] Validate extension login without unexpected local-network/WebAuthn prompts.
    - [ ] Validate token renewal and expired-session recovery path.
    - [ ] Validate logout/revoke and blocked access after logout.

- [ ] **Lot 5 — Local Chrome tools (service worker)**
  - [ ] Create `ui/chrome-ext/tool-executor.ts` with implementations:
    - [ ] `tab_read_dom` (extract DOM text via `chrome.scripting.executeScript`)
    - [ ] `tab_screenshot` (capture via `chrome.tabs.captureVisibleTab`)
    - [ ] `tab_click` (click by selector or coordinates)
    - [ ] `tab_type` (type text into input element)
    - [ ] `tab_scroll` (scroll page by direction/pixels)
    - [ ] `tab_info` (page metadata: URL, title, headings, links)
  - [ ] Create `ui/src/lib/stores/localTools.ts` (LocalToolStore + execution bridge)
  - [ ] Wire service worker message listener to tool executor
  - [ ] Wire ChatPanel to intercept local tool calls from SSE stream
  - [ ] Lot gate: tools execute correctly from the extension context

- [ ] **Lot 6 — API evolution for local tools**
  - [ ] Add `localToolDefinitions` optional field to `POST /chat/messages` input
  - [ ] Merge local tool definitions with server tools in `chat-service.ts`
  - [ ] Add `POST /api/v1/chat/messages/:id/tool-results` endpoint
  - [ ] Implement generation resume after receiving local tool result
  - [ ] Lot gate: `make typecheck-api ENV=test` + `make lint-api ENV=test`

- [ ] **Lot 7 — Integration & i18n**
  - [ ] Wire end-to-end: user asks to read page → LLM calls `tab_read_dom` → extension executes → result sent to API → LLM continues
  - [ ] i18n initialization from `chrome.i18n.getUILanguage()`
  - [ ] Verify all UI modes: floating bubble, popup, side panel placeholder
  - [ ] Lot gate: full flow works manually

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Refactor and integrate `spec/SPEC_CHROME_PLUGIN.md` into existing specs (if not a new standalone spec).
  - [ ] Update `TODO.md` to reflect completed items.

- [ ] **Lot N — Final validation**
  - [ ] **API tests**
    - [ ] Add tests for `localToolDefinitions` merge in chat-service
    - [ ] Add tests for `tool-results` endpoint
    - [ ] Scoped runs: `make test-api SCOPE=tests/your-file.spec.ts ENV=test`
    - [ ] Sub-lot gate: `make test-api ENV=test`
  - [ ] **UI tests (TypeScript only)**
    - [ ] Add unit tests for `core/` abstractions (context-provider, api-client, auth-bridge, navigation-adapter)
    - [ ] Add unit tests for `localTools.ts` store
    - [ ] Scoped runs: `make test-ui SCOPE=tests/your-file.spec.ts ENV=test`
    - [ ] Sub-lot gate: `make test-ui ENV=test`
  - [ ] **E2E tests**
    - [ ] Prepare E2E build: `make build-api build-ui-image API_PORT=8788 UI_PORT=5174 MAILDEV_UI_PORT=1084 ENV=e2e`
    - [ ] Non-regression on existing chat E2E tests
    - [ ] Scoped runs: `make test-e2e E2E_SPEC=tests/your-file.spec.ts API_PORT=8788 UI_PORT=5174 MAILDEV_UI_PORT=1084 ENV=e2e`
    - [ ] Sub-lot gate: `make clean test-e2e API_PORT=8788 UI_PORT=5174 MAILDEV_UI_PORT=1084 ENV=e2e`
  - [ ] Final gate: Create PR with BRANCH.md content as initial message & Verify CI for the branch
  - [ ] Final commit removes `BRANCH.md` and checks `TODO.md`
