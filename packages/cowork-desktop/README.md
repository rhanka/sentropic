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

## Status

BR-41a Lot 4. Real Windows capture/input verification is deferred to UAT
(Lot N-2). Packaging into a portable Windows zip / Node SEA is Lot 5. The tray
UI is deferred to Lot 5 / UAT; this package ships the consent model plus a
headless decision hook.
