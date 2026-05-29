# @sentropic/cowork-desktop

Sentropic Cowork desktop binary package. Provides:

- A **device-code enrollment client** (RFC 8628-style) that obtains a Sentropic
  session token pair without a browser cookie, then refreshes it via the shared
  `@sentropic/cowork-bridge` auth lifecycle.
- A **presence registry client** that registers the workstation as
  `source: "desktop_cowork"` with 15s keepalive and unregisters on quit, so the
  Sentropic chat can target it.
- **Desktop tool executors** mapped onto the local-tool protocol from
  `@sentropic/cowork-bridge`:
  - `screen_capture` (eyes) — captures a screen/region and returns a base64 image.
  - `input_action` (hands) — `click(x,y)` / `type(text)` / `scroll(dx,dy)` /
    `key(combo)`.
- A **per-tool consent model** (default DENY; `allow_once` / `allow_always` /
  `deny`) persisted via a `StorageAdapter`, with an executor wrapper that gates
  every tool call.

## Platform constraint

Dev/CI is Linux/Docker; the real eyes/hands only run on Windows. Capture and
input are therefore structured behind a `DesktopCapabilityProvider` interface:

- The real Windows provider (`createWindowsCapabilityProvider`) loads native
  libraries via **dynamic import** (`screenshot-desktop` for capture,
  `@nut-tree-fork/nut-js` for input). They are declared as
  `optionalDependencies` so `npm ci` on Linux/CI never fails; the provider
  lazy-loads them at runtime and throws a clear "capability unavailable" error
  when missing.
- A **mock/fake provider** (`createMockCapabilityProvider`) is used by all unit
  tests — no native libs, no display, headless.

## Windows packaging (single signable .exe)

Run from the repo root: `make package-desktop-windows`. It cross-builds the
binary entirely on Linux/Docker (BR41a-Q2/BR41-Q1) and produces a single
`cowork.exe` plus a distribution zip under `ui/static/cowork-desktop/`
(gitignored, same as the chrome-ext zip).

Pipeline (`packaging/`):

1. **esbuild** (`packaging/esbuild.config.mjs`) bundles `packaging/entry.mjs`
   (which pulls in `src/index.ts` + `@sentropic/cowork-bridge` +
   `@sentropic/chat-ui`) into one CommonJS file targeting Node 24. The native
   optional libs (`screenshot-desktop`, `@nut-tree-fork/nut-js`) are kept
   **external** — they load at runtime from disk, not from the snapshot.
2. **@yao-pkg/pkg** (the maintained pkg fork) cross-compiles the bundle to
   `node24-win-x64` → `cowork.exe`, embedding the Node runtime. pkg is preferred
   over Node SEA because it cross-compiles from Linux and embeds Node directly;
   if pkg cannot produce a working exe the script STOPS and reports (no silent
   folder-zip fallback — the user chose a single signable exe).
3. **Native prebuilds for win-x64**: while still on Linux, the script runs
   `npm install --os=win32 --cpu=x64 ...` into a staging dir. npm 10+ honours
   `--os`/`--cpu` to force the *target* platform's optional binaries (prebuilt
   `.node` / win DLLs). The resulting `node_modules/{screenshot-desktop,
   @nut-tree-fork/nut-js}` are shipped next to the exe inside the zip, so the
   runtime dynamic `import()` in `windows-provider.ts` resolves on Windows.
4. **Authenticode signing (gated)**: if `COWORK_SIGN_PFX` (path to an OV `.pfx`)
   is set, the exe is signed with `osslsigncode` using `COWORK_SIGN_PASS` and a
   timestamp server (`COWORK_SIGN_TS_URL`, default
   `http://timestamp.digicert.com`). If `COWORK_SIGN_PFX` is absent, signing is
   skipped with a clear "unsigned" warning and the unsigned exe is still emitted.
   Certs/passwords are read from env/mounted file only — never committed.

The build (`build/`) and the download artifacts (`ui/static/cowork-desktop/`)
are gitignored. A metadata file `cowork-desktop-metadata.json` records the
version, platform, and signed flag, mirroring the chrome-ext metadata.

## Status

BR-41a Lot 5. Real Windows capture/input verification + running the signed exe
are deferred to UAT (Lot N-2): the exe is built on Linux and not executed here.
The actual signing run with a real OV `.pfx` is **attendu** (run by the conductor
once the user provides the cert + password). The tray UI is deferred to UAT;
this package ships the consent model plus a headless decision hook.
