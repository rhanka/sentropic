# G0 result — GAS V8 feasibility (spec r3, sha256 078f057b...d33)

Status: BLOCKED — not run. No pass/fail verdict exists. G1 is not started (it depends on a G0 pass).

## Why it is blocked
- G0 questions (spec §7): `Utilities.computeDigest` string/byte overloads, Promise/async, `TextEncoder`/`crypto` globals,
  Properties value and key-count limits, `LockService`, project quota, **on the Airbus tenant** (precondition U1/U2).
- Running them needs a Google Apps Script project in the Airbus Workspace (clasp push or script editor session as an Airbus
  user). This build session has no `clasp`, no Airbus Workspace session and no route to the laptop; the spec assigns
  Airbus runs to the owner-run protocol on the airbus-laptop (h2a instance), and the h2a MCP failed to connect.
- Node-side results would not be GAS evidence (the questions are about the GAS runtime itself), so none is recorded.

## What is delivered
- `Code.gs`: a single-function probe `runG0()` that answers each G0 question and logs one JSON line. No network, no
  dossier data; throwaway Properties keys `g0:*` are deleted.

## How to run (owner-run, Airbus tenant)
1. New Apps Script project, runtime V8 (`appsscript.json` `runtimeVersion: V8`), paste `Code.gs`.
2. Run `runG0` as the Airbus user; copy the logged JSON line into `G0-RESULT-DATA.json` on this branch.
3. Quotas (project/file size) are read from the script editor/Google docs for the tenant and noted beside it.

## Pass criteria (derived from the spec; the spec gives no numeric thresholds)
| Question | Needed for G1/G2 | Pass |
|---|---|---|
| computeDigest string = UTF-8, bytes = signed `number[]` | `DigestPort` (§2, A6) | `abc` -> `ba7816bf...f20015ad`; non-ASCII matches `node:crypto` utf-8; signed bytes match |
| V8 level / ES2019 syntax | esbuild target es2019 (§1) | `es2019_probe` returns without ERR |
| `TextEncoder`/`crypto` absent or present | design assumes absent; injected port either way | informational, never a fail |
| Properties value >= ~1 KB and key count >= 100s | only mode (a) index (§5) | informational for S1 (mode b uses none) |
| `LockService` script lock | mode (a) only | informational for S1 |
| `getActiveUser` domain returned | §3 identity | non-empty domain for an Airbus user; empty = R3 risk |
Hard fail for S1: computeDigest string overload not UTF-8 / not SHA-256, or ES2019 syntax unsupported.
