# G0 conservative assumptions (conductor decision 2026-11-07)

G0 cannot run before the Airbus laptop is available. G1/G2 therefore assume only what holds on ANY Apps Script V8 runtime.
Each assumption is encoded twice: a fail-closed runtime probe in the bundle (`src/gas/probe.ts`, typed errors, run at
startup) and a check in `g0-probe.gs` (run once on the tenant; prints a JSON verdict). G0 on the laptop only confirms them.

| Id | Assumption | Bundle probe error | g0-probe.gs check |
|----|------------|--------------------|-------------------|
| A-DIGEST | sha256 only via `Utilities.computeDigest(SHA_256, bytes)` on signed bytes; the core encodes UTF-8 itself (pure JS) | `probe_digest_mismatch`, `probe_digest_unavailable` | `digest_bytes_*` |
| A-SYNC | no `Promise`/`async` scheduling, `TextEncoder`, WebCrypto, `URL`, timers: the gas entry is fully synchronous | A1 vm test strips these globals | INFO only |
| A-SYNTAX | output is ES2019, IIFE, no eval/dynamic import | A2 static gate | `syntax_es2019` |
| A-PROPS | Properties values chunked at 8192 bytes (< 9 KB); key budget 100 per store | `probe_props_chunk`, `props_key_budget_exceeded` | `props_chunk_8192`, `props_key_budget` |
| A-LOCK | publish serialized by `LockService.getScriptLock()`; failure to lock refuses to publish | `probe_lock_unavailable`, `lock_timeout` | `lock_script` |
| A-IDENTITY | `Session.getActiveUser().getEmail()` yields the viewer email under USER_ACCESSING | `identity_unavailable` (null identity) | `active_user_email` |

Deviation from spec §2: the spec's `DigestPort.sha256(string | number[])` relied on the string overload (UTF-8). The
decision removes that reliance: the port takes `number[]` bytes plus a pure `sha256Utf8(string)` helper in the core.
Run: paste `g0-probe.gs` into a V8 project, run `runG0`, commit the JSON as `G0-RESULT-DATA.json`.
