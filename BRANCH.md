# Feature: Cowork desktop — recette fixes (BR-41b opening)

## Objective
Fix the 3 issues found in the BR-41a Windows recette so the binary is downloadable + enrollable without friction: zero-config API default, a clickable/auto-opened pairing flow, and a single-file `.exe` (no zip). Functional tool-driving (server desktop-tool injection + device→stream + SSE) is SPLIT to a dedicated backend branch (user decision after Opus 4.8 peer review; findings recorded in the spec). Design + decisions: `spec/SPEC_COWORK_41B_FIXES.md` (Codex + Opus 4.8 reviewed).

## Scope / Guardrails
- Scope limited to `packages/cowork-desktop/**`, the cowork download API route, and the device-pair UI confirmation. No webview (separate later branch).
- Make-only workflow; `ENV=<env>` last argument.
- Branch dev in isolated worktree `tmp/feat-cowork-desktop-fixes`. Ports (BR-41 slot): API 9205 / UI 5405 / Maildev 1305.
- Automated tests on `ENV=test-cowork-desktop-fixes` / `ENV=e2e-cowork-desktop-fixes`, never root `dev`.
- Iteration/UAT = option (a): merge to main → deploy → UAT on the release channel at `sentropic.sent-tech.ca` (branches do not deploy).
- Windows runtime of Fix ③ (extraction/dlopen) is NOT validatable in CI (ubuntu runners) → de-risk via cross-platform unit tests on Linux; the Windows verdict is the user UAT.
- All new text in English. `package.json` version bump for `@sentropic/cowork-desktop` (CI `enforce-package-bump`).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `packages/cowork-desktop/**`
  - `api/src/routes/api/cowork-desktop.ts`
  - `ui/src/routes/auth/devices/pair/+page.svelte`
  - `ui/src/locales/fr.json`, `ui/src/locales/en.json`
  - `spec/SPEC_COWORK_41B_FIXES.md`, `BRANCH.md`
- **Forbidden Paths**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `plan/NN-BRANCH_*.md`
- **Conditional Paths (need `BRxx-EXn`)**:
  - `.github/workflows/ci.yml` (only if packaging output rename breaks the existing build-ui step)
  - `api/src/routes/auth/device.ts` (only if server-side pairing/rate-limit proves necessary; default plan = no server change)
- **Exception process**: declare `CDF-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- (none yet)

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network/model nondeterminism (≥1 same-commit/same-command success); never inflate timeouts; if unrelated to this change, record command + file + signature here and capture user sign-off before merge. Known allowlist: `api/tests/ai/**`, e2e 00/03/07.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single coherent worktree, one CI cycle, merge-fast to main for UAT)
- [ ] **Multi-branch**
- Rationale: one tightly-coupled binary; lots are sequential, no orthogonal sub-streams.

## UAT Management (in orchestration context)
- Mono-branch: code all lots, merge to main, deploy, then user UAT on the release channel (option (a)).
- UAT (the user, Windows machine reaching only `sentropic.sent-tech.ca`) is the runtime gate for Fix ② (pairing), Fix ③ (single-exe extraction/dlopen), and SSE (agent drives tools).

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `spec/SPEC_COWORK_41B_FIXES.md`, `rules/MASTER.md`, `rules/workflow.md`.
  - [x] Worktree `tmp/feat-cowork-desktop-fixes` off main; branch verified; ports 9205/5405/1305 free.
  - [ ] Peer review of THIS plan's implementation options with Opus 4.8 max (esp. Lot 3 resolution mechanism + Lot 4 SSE wiring); fold reversible improvements, batch irreversible/naming decisions.
  - [ ] Confirm durable names (env `SENTROPIC_APP_ORIGIN`, cache dir `%LOCALAPPDATA%\Sentropic\Cowork\`, any new make/CLI flags) — validate before merge (no-unvalidated-naming).

- [x] **Lot 1 — Fix ① default API base URL**
  - [x] Single resolver `resolveApiBaseUrl()` (`src/config/api-base-url.ts`): env `SENTROPIC_API_BASE_URL` (trimmed) wins, else baked `DEFAULT_API_BASE_URL` = `https://sentropic.sent-tech.ca/api/v1` (overridable at packaging via esbuild `define __COWORK_DEFAULT_API_BASE_URL__`, `typeof`-guarded for the dist build). One obvious place.
  - [x] Extracted shared `runCli()` (`src/cli/run.ts`); `bin/cowork.mjs` + `packaging/entry.mjs` are now thin wrappers → cannot drift. Help text fixed in `usage()` (dropped `api.sentropic.app`, dropped "required"). NOTE: the generated launcher `.cmd` help is fixed in Lot 3 (it lives in `package-windows.mjs`).
  - [x] Lot gate:
    - [x] `make typecheck-cowork-desktop` (exit 0) — no per-package lint target (CI `validate-cowork-desktop` = typecheck+test+build+pack).
    - [x] **Unit**: `packages/cowork-desktop/tests/api-base-url.spec.ts` (flat, per existing convention) — env override > baked default; trims; rejects blank.
    - [x] Sub-lot gate: `make test-cowork-desktop ENV=test-cowork-desktop-fixes` → 40 passed.

- [ ] **Lot 2 — Fix ② pairing URL + safe auto-open + approve confirmation**
  - [ ] Binary: `deriveAppOrigin(apiBaseUrl)` via `URL` (strip configurable API prefix: `/api/v1`, `/api`, trailing slash, subpath); `SENTROPIC_APP_ORIGIN` override (highest precedence); build `…/auth/devices/pair?user_code=…`; hard-validate https + no userinfo + no injected path before use; binary IGNORES server `verification_uri`.
  - [ ] Binary: print the URL+code prominently; auto-open browser via safe argv spawn (`cmd /c start "" "<url>"` discrete arg), best-effort + graceful fail; `--no-open` flag.
  - [ ] UI: add the prominent "you are pairing device «name» — did YOU start this?" confirmation in the pair PAGE wrapper `ui/src/routes/auth/devices/pair/+page.svelte` (NOT inside `AuthDevicePair`/auth-ui — out of scope); i18n strings in fr/en.
  - [ ] Lot gate:
    - [ ] `make typecheck-cowork-desktop` + `make typecheck-ui` + lint
    - [ ] **Unit (binary)**: `packages/cowork-desktop/tests/enroll/derive-app-origin.spec.ts` — edge cases (trailing slash, `/api`, `/api/v1`, subpath, https-reject, userinfo-reject, `SENTROPIC_APP_ORIGIN` override).
    - [ ] **UI test**: extend `ui/tests/**` or e2e `06`-style for the pair confirmation render (TS only).
    - [ ] Sub-lot gate: `make test-cowork-desktop` + `make test-ui ENV=test`

- [ ] **Lot 3 — Fix ③ single-file packaging**
  - [ ] **3a (spike/gate, cross-platform de-risk):** add a native-resolution module that, given a cache dir, extracts the embedded native tree (atomic temp+rename, sha256 manifest verify, purge stale) and returns a `file://` URL to the `@nut-tree-fork/nut-js` entry; `windows-provider.ts` imports THAT (not the bare specifier). Unit-test the extract+resolve+import path on Linux using the linux libnut build (proves the mechanism; Windows dlopen left to UAT).
  - [ ] **3b:** `package-windows.mjs` — embed ONLY win32-x64 native assets (prune linux/darwin/dev) as pkg `assets` incl. libnut `build/Release/` sidecar DLLs; emit the sha256 manifest; stop producing the zip → single `cowork.exe` (+ metadata `exe`).
  - [ ] **3c:** `api/src/routes/api/cowork-desktop.ts` — serve `cowork.exe` (rename `DEFAULT_DESKTOP_ZIP_PATH`→`DEFAULT_DESKTOP_EXE_PATH` + origin-fallback + metadata `zip`→`exe`). UI util unchanged (consumes `downloadUrl`). FIRST confirm no e2e/api test asserts the `.zip` filename.
  - [ ] Lot gate:
    - [ ] `make typecheck-cowork-desktop` + `make typecheck-api` + lint
    - [ ] **Unit**: `packages/cowork-desktop/tests/packaging/native-extract.spec.ts` (manifest verify, atomic rename, concurrent-extract, purge).
    - [ ] **API test**: update `api/tests/**` for the cowork-desktop route serving `.exe` (path + metadata).
    - [ ] CI build: `build-ui` step `make package-desktop-windows` produces a single `.exe` (no zip) — verify in CI logs.
    - [ ] (Windows runtime → UAT)

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Fold behavior changes into `spec/SPEC_COWORK.md`; keep `spec/SPEC_COWORK_41B_FIXES.md` as the design record or fold + delete per convention.

- [ ] **Lot N — Final validation + merge (option a) + UAT**
  - [ ] Typecheck & lint (cowork-desktop, api, ui)
  - [ ] `make test-cowork-desktop`, `make test-api ENV=test-cowork-desktop-fixes`, `make test-ui ENV=test`
  - [ ] `make build-api build-ui-image API_PORT=9205 UI_PORT=5405 MAILDEV_UI_PORT=1305 ENV=e2e-cowork-desktop-fixes` + `make clean test-e2e … ENV=e2e-cowork-desktop-fixes` (matrix groups per ci.yml); document AI-flaky signatures + user sign-off.
  - [ ] Bump `packages/cowork-desktop/package.json` (minor) — CI `enforce-package-bump`.
  - [ ] PR with this `BRANCH.md` as body; CI green (rerun documented AI flakes).
  - [ ] Merge to main → deploy → **UAT** on `sentropic.sent-tech.ca` release channel:
    - [ ] download single `cowork.exe`; double-click (no env) → reaches API.
    - [ ] pairing URL printed + browser auto-opens, code pre-filled; approve in logged-in browser → binary enrolls.
    - [ ] first run extracts native once (instant on second run); two simultaneous runs both work.
    - [ ] binary registers (presence) — tool EXECUTION is deferred to the backend tool-driving branch (out of scope here).
  - [ ] Remove `BRANCH.md`, push, merge-commit.
