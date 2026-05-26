# SPEC — Sentropic Cowork (BR-41 study)

Status: study / design (BR-41 registration umbrella). Owner: BR-41a then BR-41b.
Related: `spec/SPEC_CHROME_PLUGIN.md` (enrollment + local-tool precedent), `PLAN.md` (BR-41a/b).

## 1. Purpose & scope

Sentropic Cowork is a **portable, all-TypeScript Windows binary** (distributed as a zip, no
installer) that acts as a "Claude Cowork"-style companion on the workstation. Its first goal is
to expose **desktop tools** — *hands* (keyboard/mouse), *eyes* (screen capture) — to the Sentropic
agent, enabling **agentic remote control** of the PC from the Sentropic chat. It reuses the same
enrollment and local-tool mechanism as the Chrome plugin. A later stage embeds a **third-party
webview** hosting the existing chat UI locally (mini-browser / workspaces).

In scope (BR-41 as a whole):
- A published **client bridge** package consolidating the shared, transport/storage-agnostic
  client core (auth/enrollment, tool protocol types, SSE client reuse).
- A **device-code enrollment** flow (a headless binary has no browser session cookie).
- **Desktop tools** mapped onto the existing local-tool protocol (`localToolDefinitions` →
  `tool_call` → `tool-results`), with a per-tool consent model.
- A **portable Windows binary** packaging pipeline (Node SEA or pkg), built from Docker/Linux.
- A later **local webview** hosting `@sentropic/chat-ui`.

Out of scope (deferred / explicitly excluded for now):
- *ears* (microphone / system-audio capture).
- Human live screen-streaming (VNC/TeamViewer-style real-time video + raw input). The model here
  is **agentic computer-use**, not human teleoperation.
- macOS / Linux desktop builds.
- Code signing / notarization (tracked as an open decision, see §12).

## 2. Reused mechanisms (from the Chrome plugin)

The Chrome plugin already implements the contract Cowork reuses. Key references:
- Enrollment: `POST /auth/session/extension-token` (needs an existing app session), `POST
  /auth/session/refresh`, `DELETE /auth/session`. Backend: `api/src/routes/auth/session.ts`,
  `api/src/services/session-manager.ts`. Client: `ui/chrome-ext/extension-auth.ts`.
- Presence / targeting: `POST /chrome-extension/tabs/register` + 15s keepalive, in-memory registry
  `api/src/services/tab-registry.ts`, routes `api/src/routes/api/chrome-extension.ts`. This is how
  the web app targets a connected client.
- Local-tool protocol: chat sends `localToolDefinitions`; the LLM emits `tool_call`; the client
  executes locally and posts `POST /chat/messages/:id/tool-results`. Reference desktop-side tools:
  `ui/chrome-ext/tool-executor.ts` (`tab_read`, `tab_action`), permissions
  `ui/chrome-ext/tool-permissions.ts`.
- Streaming: SSE `GET /streams/sse` (Bearer). Portable client already exists in `@sentropic/chat-ui`
  (`StreamHub`, `client/streamTypes.ts`).
- Shared client core (already decoupled from SvelteKit/Chrome): `ui/src/lib/core/`
  (`context-provider.ts`, `api-client.ts`, `navigation-adapter.ts`).

The Chrome plugin's enrollment/tool code is ~30% Chrome-coupled (`chrome.storage`,
`chrome.runtime`, `chrome.scripting`); the remaining logic (HTTP contracts, token lifecycle math,
protocol types) is portable behind small adapter seams.

## 3. Architecture

```
@sentropic/cowork-bridge (published npm package)
   ├─ core: ApiClient / ContextProvider / NavigationAdapter   (extracted as-is from ui/src/lib/core)
   ├─ auth: extension-token + refresh + token lifecycle, behind StorageAdapter + injected fetch
   ├─ tools: local-tool protocol types (definition / call / result) — executor-agnostic
   └─ depends on @sentropic/chat-ui for the SSE StreamHub
        ▲                         ▲                                  ▲
   web app (consumes)     chrome-ext (refactored to consume)   Cowork.exe (new, BR-41a)
```

Backend additions (BR-41a, `api/`):
- A **device-code** enrollment flow (new endpoints) so a browserless binary can obtain a session
  token pair, reusing `session-manager` to mint the same JWT + refresh pair as the extension.
- The presence registry accepts a **non-browser device** source (`source: "desktop_cowork"`) so the
  chat can target the enrolled workstation.

Client binary (BR-41a):
- Node bundled with `esbuild` → packaged as a portable Windows artifact (Node SEA, fallback pkg),
  cross-built from Docker/Linux. Minimal tray + pairing screen (shows the `user_code`).

## 4. Client bridge package (`@sentropic/cowork-bridge`)

Follows the existing `packages/*` conventions (npm workspace, `@sentropic/*`, `tsc` build, ESM,
OIDC publish; see `rules/workflow.md → Package Publication`). First publish requires the one-shot
bootstrap (`workflow_dispatch` `bootstrap_publish_target`) + OIDC trusted publisher attach.

Contents:
- **core** — `ApiClient`, `ContextProvider`, `NavigationAdapter` extracted from `ui/src/lib/core/`
  (already free of `$app/*` and `chrome.*`). Web app and chrome-ext re-point imports here.
- **auth** — the portable parts of `ui/chrome-ext/extension-auth.ts`: JWT exp decoding, refresh-skew
  logic, user normalization, and the `extension-token` / `refresh` / logout HTTP contracts. Storage
  is abstracted behind a `StorageAdapter` (persistent + session); `fetch` is injected. Chrome
  implements the adapter with `chrome.storage`; the binary implements it with an OS file/credential
  store.
- **tools** — protocol types only (`ToolDefinition`, `ToolCall`, `ToolResult`, `ToolExecutor`,
  `ToolExecutionContext`) plus the portable permission schema. Execution is supplied per host.
- **streaming** — re-export / depend on `@sentropic/chat-ui` `StreamHub`; the binary injects a
  Node-side `eventSourceFactory` (fetch + ReadableStream SSE parser) instead of the browser
  `EventSource` / extension port proxy.

Non-regression risk (the sensitive part of BR-41a Lot 1): the **already-shipped Chrome extension**
is refactored to consume the package; its build + tools must stay green (CI extension job).

## 5. Enrollment — device-code flow

A headless binary has no browser cookie to call `extension-token` directly, so it uses a
device-code handshake (RFC 8628-style) that ends by minting the same token pair.

Sequence:
1. Binary → `POST /auth/device/code` → `{ device_code, user_code: "PAIR-7F3K", verification_uri,
   interval, expires_in }`.
2. User → opens the Sentropic web "pair a device" page (authenticated), enters `user_code`, sees the
   requested device name, confirms.
3. Binary → polls `POST /auth/device/poll { device_code }` at `interval` → on approval returns
   `{ sessionToken, refreshToken, expiresAt, user }` (via `session-manager.createSession` with the
   device name), else `authorization_pending` / `slow_down` / `expired`.
4. Binary stores the token pair via its `StorageAdapter`; refresh thereafter is identical to the
   Chrome plugin (`/auth/session/refresh`).

Backend work (BR-41a): a short-lived device-code store (DB or in-memory with TTL), the two
endpoints above, and a minimal web "pair a device" page (enter code + confirm). Throttled polling,
single-use codes, short expiry.

## 6. Device registry & chat targeting

Reuse the presence registry pattern (`tab-registry.ts`) so the chat can target the workstation:
- The binary registers after enrollment with `source: "desktop_cowork"` (id e.g. `device_<uuid>`),
  keepalive every 15s, eviction at 45s, unregister on quit.
- The chat target selector lists connected targets; when targeting the Cowork device, the chat sends
  the desktop `localToolDefinitions` and routes `tool_call`s to it.
- Decision to settle in BR-41a: extend `tab-registry` to carry non-browser sources vs introduce a
  sibling `device-registry`. Default: extend the existing registry (smallest change, one targeting
  surface in the UI).

## 7. Desktop tools (eyes + hands)

Mapped onto the existing protocol (no backend protocol invention):
- `screen_capture` (eyes) — args: target screen / region; returns an image (mirrors `tab_read
  mode:screenshot`). Used as the observation step of the agentic loop.
- `input_action` (hands) — `click(x,y)`, `type(text)`, `scroll(dx,dy)`, `key(combo)`.

Execution uses pure-JS Windows-capable libraries to keep the artifact bundleable (e.g.
`screenshot-desktop` for capture, `nut.js` / `@nut-tree` for input; fallback to a native SendInput
binding only if required). Each tool plugs into the bridge's `ToolExecutor` seam.

Consent model (mandatory — this is a remote-control surface): reuse the tool-permission model
(`allow_once` / `allow_always` / `deny`) per tool, surfaced in the tray. Default deny until the user
grants. The agentic loop is: `screen_capture` → model decides → `input_action` → repeat.

## 8. Portable Windows binary

- Bundle: `esbuild --platform=node --target=node24 --bundle` → single JS entry (the toolchain
  already uses esbuild in `api/`).
- Package: **Node SEA** (single executable application, Node 24) as the primary path; **pkg** as a
  fallback if SEA blob injection from Docker/Linux proves brittle. Both can cross-target Windows from
  a Linux container. Tradeoff: SEA/pkg artifacts bundle the Node runtime (~80–200 MB).
- Fallback distribution if single-exe is blocked by a native module: a **folder-zip** (bundled JS +
  a pinned `node.exe`), launched by a small `.cmd`.
- Native libraries: prefer prebuilt-binary or pure-JS modules so they survive bundling; document any
  module that needs a sidecar `.node`/DLL in the zip.
- Build via a new `make` target (mirrors `make build-ext-chrome` + `package-extension-zip.js`),
  output under `ui/static/desktop/` with a `GET /api/v1/.../download` metadata endpoint analogous to
  the Chrome extension download. CI gains a cross-build/publish job mirroring the chrome-ext zip job.
- Note: the new `make` target and `docker-compose*` are default-Forbidden paths → BR-41a will need a
  scoped exception (`BR41a-EXn`) to add the target.

## 9. BR-41a vs BR-41b

- **BR-41a `feat/cowork-desktop-tools`** — extract+publish the bridge (Lot 1, includes chrome-ext
  refactor + non-regression), backend device-code + device registry, desktop tools (eyes+hands),
  portable Windows zip, chat driven from the Sentropic web app. Starts with a throwaway proto (§10).
- **BR-41b `feat/cowork-local-webview`** — embed a third-party webview hosting `@sentropic/chat-ui`
  locally (mini-browser / workspaces), so the chat runs inside the binary. Depends on the published
  bridge from BR-41a. Webview engine (Neutralino / wry-sidecar / Electron / WebView2) decided at the
  start of BR-41b.

## 10. Fast proto (start of BR-41a, throwaway spike)

Goal: validate end-to-end feasibility before the bridge refactor and packaging investment.
- A minimal Node script that (a) enrolls with a **manually pasted token** (temporary shortcut, not
  device-code), (b) registers as `desktop_cowork` in the registry, (c) executes a single
  `screen_capture` driven from the Sentropic chat and returns it via `tool-results`.
- Success criterion: the backend accepts a non-browser device and a desktop tool round-trips through
  the chat. On success, proceed to the bridge + device-code + packaging lots; the spike is discarded.

## 11. Security model

- The binary is a user-installed companion enrolled with the user's **own** Sentropic account; it
  controls **their own** workstation. Not a covert/remote-admin tool.
- Per-tool consent (default deny), visible tray state, and an explicit "disconnect / revoke" that
  deletes the session (`DELETE /auth/session`) and clears stored tokens.
- Tokens stored via OS-appropriate storage (credential manager / protected file), never plaintext in
  the zip directory.
- Device-code: single-use codes, short expiry, throttled polling, explicit user confirmation with
  device name shown.
- No admin elevation required for standard `SendInput` / screen capture on the interactive desktop;
  document any UAC/secure-desktop limitations.

## 12. Risks & open questions

- **BR41-Q1** — Code signing: an unsigned portable binary triggers SmartScreen/AV warnings. Decide
  signing strategy (deferred; likely out of BR-41a). Tracked in BR-41a plan.
- Chrome-ext refactor non-regression (BR-41a Lot 1) — the extension already ships; its CI must stay
  green after re-pointing to the bridge package.
- SEA vs pkg vs folder-zip — validated at packaging time; folder-zip is the guaranteed fallback.
- Registry choice — extend `tab-registry` vs new `device-registry` (default: extend).
- Native input/capture module bundling into a single exe (default: pure-JS/prebuilt; folder-zip
  fallback otherwise).
- New `make`/compose target requires a scope exception in BR-41a.

## 13. References

- `spec/SPEC_CHROME_PLUGIN.md`
- `ui/chrome-ext/extension-auth.ts`, `ui/chrome-ext/tool-executor.ts`, `ui/chrome-ext/tool-permissions.ts`
- `ui/src/lib/core/{context-provider,api-client,navigation-adapter}.ts`
- `api/src/routes/auth/session.ts`, `api/src/services/session-manager.ts`, `api/src/services/tab-registry.ts`
- `packages/chat-ui/src/client/{streamHub,streamTypes}.ts`
- `rules/workflow.md → Package Publication`
