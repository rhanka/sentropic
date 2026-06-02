# Design — BR-41b opening fixes (Cowork desktop 41a follow-ups)

Status: design (brainstorm output; Codex + Opus 4.8 adversarial reviews folded; pending user review)
Date: 2026-06-01
Scope: the opening lots of BR-41b — 3 recette fixes (Windows) + wiring the SSE consume loop so the binary is functional end-to-end. The local webview / mini-browser hosting chat-ui (the main 41b feature) follows these.

## Context

BR-41a shipped the Cowork desktop binary + download plumbing; it is live and downloadable from `https://sentropic.sent-tech.ca`. Windows recette surfaced 3 usability defects. These are corrections to 41a behavior, iterated via the admin **prerelease** channel built in 41a, taken as the opening lots of BR-41b.

Verified current state (code refs in `packages/cowork-desktop`, `api/src/routes/auth/device.ts`):
- Binary requires `SENTROPIC_API_BASE_URL` with no default (`bin/cowork.mjs:18`); help text points at a wrong domain (`api.sentropic.app`).
- Device-code flow (RFC 8628) is fully implemented end-to-end (API issues code + verification_uri; UI pages `auth/devices` + `auth/devices/pair` exist; `/auth/device/approve` binds the code to the logged-in user). BUT `device.ts:55` builds `verification_uri` from the request `Origin` header, which a headless binary never sends → URL degrades to host-less `/auth/devices/pair` → user gets a code but no usable web address.
- `package-windows.mjs` builds `cowork.exe` via @yao-pkg/pkg but ships native deps in a sibling `node_modules/` → distributed as a 122-file zip (~48.8 MB) slow to unzip and not durable. The two native deps differ (Opus 4.8 verified): `@nut-tree-fork/nut-js` loads `libnut.node` (+ sidecar MSVC runtime DLLs) via `bindings`; `screenshot-desktop` on win32 is NOT a `.node` — it ships a `.bat` (`screenCapture_*.bat`) that it copies to `%TEMP%` and runs via `cmd.exe`. The staged tree currently bakes in all 3 OS libnut builds un-pruned (~52 MB).

Deployed topology (for defaults): single host `sentropic.sent-tech.ca`; the UI image nginx proxies `/api` → `api:8787`. So the real API base is `https://sentropic.sent-tech.ca/api/v1` and the app origin is `https://sentropic.sent-tech.ca` (`deploy/k8s/60-ingress.yaml`, `40-ui.yaml`).

## Fix ① — Default API base URL (decided; hardened per Codex + Opus 4.8 reviews)

The binary defaults `apiBaseUrl` to `https://sentropic.sent-tech.ca/api/v1`, still overridable by `SENTROPIC_API_BASE_URL`. Stop requiring the env. Fix the help text (drop `api.sentropic.app`).

Hardening (Codex MEDIUM + Opus MEDIUM-1/LOW-1): **runtime env override is highest precedence**; the baked default is only a build-time fallback (esbuild `define`, value JSON-quoted via `JSON.stringify`, validated as a well-formed https URL at build) so a drifted rebuild can't silently ship a wrong hard-coded endpoint without the env escape hatch. Apply to BOTH `bin/cowork.mjs` AND `packaging/entry.mjs` (byte-identical logic that must not drift — ideally extract one shared `main()` into the library) AND the launcher `.cmd` generated in `package-windows.mjs` (it also hardcodes `api.sentropic.app` + an obsolete "set SENTROPIC_API_BASE_URL" line). Three help-text occurrences total.

Acceptance: double-click `cowork.exe` (no env set) reaches the live API and starts enrollment; `SENTROPIC_API_BASE_URL=...` still overrides; the help text shows the correct live host.

## Fix ② — Pairing URL discoverability (decided: binary-side, option A; hardened per Codex + Opus 4.8 reviews)

The binary already knows its `apiBaseUrl`. It derives the app origin and builds the absolute pairing URL `…/auth/devices/pair?user_code=PAIR-XXXX`, then prints it prominently AND auto-opens the default browser. The pairing page already reads `?user_code=` and pre-fills the field, so the logged-in user just clicks "approve". No server change required.

Hardening (Codex findings, HIGH):
- **Robust derivation, not naive string trim.** Parse `apiBaseUrl` with `URL`; strip a *configurable, known* API path prefix (default `/api/v1`, but tolerate `/api`, trailing slash, and reverse-proxy subpaths) to compute the app origin+base. Add an explicit override env `SENTROPIC_APP_ORIGIN` (highest precedence) as the escape hatch when the derivation can't be trusted.
- **Safe browser open.** Use a safe spawn (argv array, no shell string interpolation of the URL) via a cross-platform open; on Windows `cmd /c start "" "<url>"` with the URL passed as a discrete arg. Auto-open is best-effort and **must fail gracefully** — ALWAYS print the copy-paste URL + code as the primary fallback (don't assume an interactive desktop). A `--no-open` flag disables auto-open.
- **Trust-boundary validation (Opus HIGH-1).** Build the URL only from trusted config (baked default / operator env), and before opening, re-serialize the parsed origin and HARD-reject scheme≠https, embedded userinfo (`user:pass@`/`@`), and any path/query injection from the env value — so a sloppy `SENTROPIC_API_BASE_URL`/`SENTROPIC_APP_ORIGIN` can't open something surprising. (Derivation has no remote input, so this is not a remote phishing vector — only self-inflicted-env hardening.) The binary IGNORES the server's returned `verification_uri` in favor of its own derivation (single source of truth).
- **Device-code phishing trade-off (Opus HIGH-2).** Auto-open lowers the manual-code-entry friction that normally mitigates RFC-8628 device-code phishing (attacker runs a binary, sends victim the PAIR URL, victim approves → attacker's binary gets a token minted as the victim). Mitigation in scope: keep a prominent "you are pairing device «name» — did YOU start this?" confirmation on the approve page (device name already captured). Follow-up (note, not this lot): rate-limit `/auth/device/code` issuance + per-user concurrent-pending cap.

Acceptance: running the binary prints a full clickable pairing URL with the code, and (best-effort) opens the browser there; approving in the logged-in browser completes enrollment (binary poll returns a token); if auto-open fails, the printed URL still works.

## Fix ③ — Single-file packaging (decided: pkg assets + one-time cache extraction, option A; hardened per Codex + Opus 4.8 reviews)

Embed the **win32-x64** native deps into `cowork.exe` as pkg `assets`; at first run extract the whole native tree to a real on-disk cache and make the runtime dynamic `import()` resolve there. Single `cowork.exe`, no zip.

Native model — corrected per Opus 4.8 review (the real shape is NOT "dlopen a `.node` + spawn a helper exe"):
- **`@nut-tree-fork/nut-js` resolution is the actual hard problem (CRITICAL-3).** It loads `libnut.node` through `bindings`, which walks UP from the caller's `__filename` to the nearest `package.json`/`node_modules`. So the ENTIRE `@nut-tree-fork/*` chain (`nut-js → libnut → libnut-win32`) + `bindings` must be extracted onto real disk under a `node_modules`, and `windows-provider.ts`'s bare-specifier `import('@nut-tree-fork/nut-js')` must be replaced by importing an **absolute `file://` URL** of the extracted entry (`pathToFileURL(join(cacheDir,'node_modules/@nut-tree-fork/nut-js/dist/index.js'))`) — bare-specifier resolution from the pkg snapshot would look inside the snapshot, not the cache.
- **`libnut.node` sidecar DLLs (CRITICAL-2).** `libnut-win32/build/Release/` ships `libnut.node` PLUS `msvcp140.dll`, `vcruntime140*.dll`, `api-ms-win-crt-*.dll`. The extraction unit is the whole `build/Release/` dir (else `dlopen` fails `STATUS_DLL_NOT_FOUND`); the manifest enumerates every file, not just `*.node`.
- **`screenshot-desktop` needs no special handling (CRITICAL-1).** Not a `.node`, no helper exe — it reads a bundled `.bat` via its own `__dirname`, copies it to `%TEMP%`, runs `cmd.exe`. Requirement is only that its module dir is on real disk. Drop the "helper exe" framing.
- **Prune to win32-x64 (HIGH-3).** Embed ONLY win32 assets (`screenshot-desktop` win32 lib + the `@nut-tree-fork/*` + `bindings` runtime tree); exclude `libnut-linux`/`libnut-darwin`, dev/test/`.github` — else the exe bloats ~50 MB and the unsigned-extraction (AV) surface grows.
- **Concurrency-safe, Windows-correct extraction (CRITICAL + MEDIUM-3).** Extract to `…\native\<version>.<rand>\`, then rename into `…\native\<version>\` ONLY if the target doesn't exist (lose-the-race → discard temp; never rename over an existing dir — Windows `rename` fails `EPERM`/`ENOTEMPTY`); retry with bounded backoff on `EPERM` (AV holds fresh `.node`/`.dll` locks). Verify a per-file sha256 manifest before use; re-extract on mismatch; purge stale version dirs.
- **Mandatory Windows spike (gate).** Lot 3 STARTS with a spike proving on a real Windows box that extracted-tree `import()` + `bindings` walk-up + libnut `dlopen` work end-to-end. Pass/fail gate before building the rest of Lot 3.

Distribution surface changes:
- `package-windows.mjs` stops producing the zip; produces `cowork.exe` (+ `cowork-desktop-metadata.json`) only.
- The download route serves `cowork.exe` directly: update `DEFAULT_DESKTOP_ZIP_PATH` + the origin-fallback path + metadata (`zip` → `exe`) in `api/src/routes/api/cowork-desktop.ts`. The UI download util needs **no change** — it consumes the API's `downloadUrl` verbatim (Opus LOW-3 corrected the earlier claim).
- The exe remains UNSIGNED (signing deferred → SmartScreen will warn; documented).

Acceptance: download a single `cowork.exe`, double-click; first run self-configures (one-time, atomic, hash-verified extraction); second run instant; two simultaneous first runs both succeed; no zip anywhere.

## Iteration via prerelease channel (DECIDED: (a))

The UAT machine reaches ONLY `sentropic.sent-tech.ca`. Branch CI bakes the exe into the UI image, but branches do not deploy to `sentropic.sent-tech.ca` (only main deploys) — so a branch-only prerelease artifact is operationally unreachable for UAT (Codex LOW finding confirms). Options:
- **(a) merge-fast-to-main + UAT the release channel** — simplest, exactly how 41a was validated (small fix lots, fast green merges, release-channel download). RECOMMENDED for these 3 fixes.
- (b) deploy the branch to a prerelease host/path under `sentropic.sent-tech.ca` (more ops).
- (c) `COWORK_DESKTOP_PRERELEASE_URL` → an object-store URL the locked-down machine can reach.

Decided: (a). The prerelease channel built in 41a stays available for when external hosting (c) is set up, but it is not relied upon for these fixes.

## Out of scope (this opening set)

- Code-signing (deferred: resold OV cert + jsign later).
- The BR-41b local webview / mini-browser hosting chat-ui (the main 41b feature) — follows these fixes.
- macOS/Linux desktop builds.

## Sequencing — this branch ships ONLY the recette fixes (tool-driving SPLIT out, user decision after Opus 4.8 peer review)

- Lot 1 — Fix ① default API base URL (+ help text) in `bin/cowork.mjs`, `packaging/entry.mjs`, launcher `.cmd`; extract a shared `main()` so the two byte-identical entrypoints can't drift.
- Lot 2 — Fix ② robust pairing-URL derivation + safe auto-open (shared `main()`) + URL trust-boundary validation; the binary STOPS printing the server's host-less `verification_uri` and prints/opens its own derived absolute URL; the "did YOU start this?" confirmation goes in the pair PAGE wrapper (`ui/src/routes/auth/devices/pair/+page.svelte`, in scope — NOT inside `AuthDevicePair`/auth-ui).
- Lot 3 — Fix ③: native-resolution module (cross-platform Linux spike = pass/fail gate) → single-file `.exe` packaging + download route serves `.exe` (rename `DEFAULT_DESKTOP_ZIP_PATH` → `DEFAULT_DESKTOP_EXE_PATH`; confirm no e2e/test asserts the `.zip`).
- Lot N — version bump `@sentropic/cowork-desktop` 0.1.0 → 0.2.0 (minor) → merge to main (option a) → UAT.

## Deferred to a dedicated branch — functional tool-driving (Opus 4.8 peer findings, recorded so the design isn't lost)

Making the agent actually drive the desktop tools is a BACKEND feature, not a client SSE loop. Grounded findings:
- **No per-device push channel.** `tool_call`s ride the chat client's OWN stream: `GET /streams/sse?streamIds=<assistantMessageId>` (`api/src/routes/api/streams.ts:231`), delivered as a `status` event `{ state:'awaiting_local_tool_results', pending_local_tool_calls:[…] }` (`packages/chat-core/src/runtime-finalization.ts:277`). The Chrome ext works only because it IS the message originator (knows the streamId; `ui/chrome-ext/background.ts:300`).
- **The headless device has no streamId** (never POSTs a message) and there is NO device-targeted SSE mode (`streams.ts` requires explicit `streamIds`). A device→stream discovery mechanism must be designed (new `streams.ts` filter, or a NOTIFY keyed to the device), with the security model: which device may read which streams (auth already binds SSE to the user via `isChatStreamAllowed`, `streams.ts:297`).
- **Server never injects desktop tools.** Injection is gated to browser sources (`chat-service.ts:2731` `filter(isBrowserSource)`; `desktop_cowork` excluded `tab-registry.ts:15`). Needs a `buildServerDesktopToolDefinitions` sibling so the model is told `screen_capture`/`input_action` exist.
- **`tool-results.ts` contract is wrong / never worked.** Server `toolResults` (`packages/chat-server/src/index.ts:643`) wants a SINGLE `{ toolCallId, result }` (camelCase, `result:unknown`) with a 400-race retry (cf `ui/src/lib/components/chat/AppChatPanel.svelte:809`); the binary posts a snake_case batch and `CoworkRunner.handleStatusPayload` posts the whole batch at once (`cowork-runner.ts:77`). Rewrite to one post per call.
- **SSE parsing**: do NOT reuse `chat-ui` `streamHub`/`transport` (browser `EventSource`); reuse the chrome-ext hand-parser pattern (`background.ts:328` `fetch`+`getReader()`+manual framing, Node-compatible) and `parsePendingLocalToolCallsFromStatusPayload` (already imported by `cowork-runner.ts:1`).

(then) local webview feature — separate design, the main 41b feature.

## Acceptance summary (UAT-ready definition — THIS branch)

Single `cowork.exe` downloaded from `sentropic.sent-tech.ca`, double-clicked with no env, prints + opens a full pairing URL with the code pre-filled; approval in the logged-in browser enrolls + registers the device; first run self-configures once (native extraction), subsequent runs are instant; two simultaneous first runs both succeed. EXECUTING tool calls (the agent driving eyes/hands) is explicitly OUT of this branch — it needs the backend tool-driving feature deferred above.
