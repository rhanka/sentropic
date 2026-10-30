# H3 validated ingress and real Hocuspocus provider witness

Scope: approved host plan r3 H3 only (lines 116-135, lot table line 49).
Plan SHA-256: `a48f54be6ce82b05e697f1c3f7dbc433ed60b69f5c2e377b6fb71faad9ababe7`.
Frozen DS specification SHA-256: `161c5dac35d1cfe6b4a1937fe2f38f900e3f73d24cbae1cbb802b4036ee36834`.
Base: `origin/main` at `8ea119c4d`; H0 #823, H1 #830, H2 #833 merged.

No application consumer is switched. No second `CanvasTemplateDescriptor`,
collaboration vocabulary, schema generator, or editor code is published (DS-owned).
`migrated 0/24`.

## Dependency closure

| Package | Installed version | Recorded and verified |
| --- | --- | --- |
| `yjs` | `13.6.27` | `api/package.json` devDeps (exact), api and root lockfiles, workspace install |
| `y-protocols` | `1.0.7` | `api/package.json` devDeps (exact), api and root lockfiles, workspace install |
| `@hocuspocus/server` | `4.7.1` | `api/package.json` devDeps (exact), api and root lockfiles, workspace install |
| `@hocuspocus/provider` | `4.7.1` | `api/package.json` devDeps (exact), api and root lockfiles, workspace install |

`api/tests/api/canvas-live-harness.test.ts` resolves each package inside the
test workspace and fails on any drift from `H3_DEPENDENCY_CLOSURE()`. The
closure is verified against the real provider, not just recorded: the same
suite instantiates a real in-process `@hocuspocus/server` (4.7.1) and drives
`onLoadDocument`, `openDirectConnection` and `onStoreDocument`. Production
transport wiring lands with H10; H3 exercises the provider in-process only.

`HocuspocusHost` exposes `onAuthenticate`, `onLoadDocument`, and `handleUpdate`
with the same hook shape as `@hocuspocus/server`, and checkpoints every applied
update through `onStoreDocument` (`storeCheckpoint`). Raw Hocuspocus ingress
stays disabled; every update passes framing, admission, classification, and
resulting-schema validation before any authoritative application, durable
journal commit, or broadcast.

## Authority and ownership

`sync-framing.ts` reassembles bounded frames before decoding: 1 MiB per-frame
cap, 8 MiB logical-update cap. The MCP JSON patch cap (256 KiB) is never
applied to sync traffic. Oversize refuses; partial logical updates refuse with
`incomplete-frame`; no truncation or partial application occurs.

`ingress.ts` decodes into an isolated scratch candidate, classifies affected
shared types and operation families, re-checks current admission, then
validates the full resulting schema. Refusals: undecodable input, stale-vector
regression, `meta` writes, foreign fields, foreign `fieldmeta`, identity
rewrites, invalid separators, duplicate paragraphs, first-separator deletes,
unsupported marks/embeds, disallowed metadata. Inherited span attributes on
separator and hard-break embeds are ignored per R-LIN-4 and accepted.
An older valid concurrent update is never refused merely for being old.

`quarantine.ts` holds unresolved structs and delete sets outside authoritative
state with submitting actor and admission. On dependency arrival it reruns
classification, current rights, and resulting-schema checks before integration.
Quarantined input never enters the journal or reaches replicas. The validated
bridge quarantines unresolvable input on the live path
(`api/tests/api/canvas-live-quarantine-wiring.test.ts`), and delayed
dependencies cannot smuggle a rejected operation across actors or fields.

`hocuspocus.ts` closes the connection after repeated hostile updates
(threshold 2 by default, configurable) and immediately on revoked actors or
wrong-document submissions; closure never applies queued input.

## RED and GREEN evidence

| Witness | Observed RED | Observed GREEN |
| --- | --- | --- |
| Sync framing: 1 MiB frame cap, 8 MiB logical cap, no truncation, partial refusal, >256 KiB catch-up framed | missing-module import error | 5 passed |
| Ingress: reserved meta, foreign field/meta, unsupported marks/embeds, R-LIN-4 acceptance, duplicates, first-separator, stale-vector dominance, resulting schema | suite failed pre-implementation (classifier missing) | 11 passed |
| Quarantine: retention, revalidation on arrival, refusal without leak, duplicate ids | missing-module import error | 4 passed |
| Quarantine wiring: live-path quarantine, cross-actor/field no-smuggling | 3 failed pre-implementation | 3 passed |
| Hocuspocus witness: full `handle.identity` resolution, R-BIND-3 two fields, fail-closed coordinates, pre-apply validation, checkpoint via `onStoreDocument` | 3 failed pre-implementation | 7 passed |
| Hostile ingress: cases i-vi, real-bytes catch-up replay (vii), no applied entry, no broadcast, revoked close | 3 failed pre-implementation | 9 passed |
| Composition: F2 awareness delivery, F6 composition convergence (api level) | 2 failed pre-implementation | 4 passed |
| Harness: dependency-closure verification, DS witness 8 against both providers, kill/restart checkpoint replay | suite new in review r1 | 4 passed |

Measured GREEN totals after the review r1 fixes: **47 tests passed** across the
scoped H3 suites (framing 5, ingress 11, quarantine 4, wiring 3, hocuspocus 7,
security 9, composition 4, harness 4), plus H2 recovery suites still green
(persistence 9, recovery/journal/freeze-capture in the full unit run). RED
evidence: before implementation, the five new modules failed to import
(missing module); before the review r1 rewrites, the rewritten suites failed
behaviorally as listed above.

## Offline harness for DS witness 8(i)

Package: `api` (`api/src/services/canvas-live/harness.ts`).
Committed entrypoints:

- Repo make target (api test container of the `ENV=test-canvas-h3` stack):
  `make test-canvas-live-harness ENV=test-canvas-h3`
- Package script (inside `api/`): `npm run test:canvas-live-harness`

The suite executes `runOfflineHarness` then `assertHarnessForDsWitness8`
against two providers selected by an explicit `provider` option echoed in the
result: `in-memory-double` (registry with injected callbacks) and `hocuspocus`
(a real in-process `@hocuspocus/server` on an ephemeral port; no external
network service). The harness resolves bindings by full `handle.identity`,
fails closed on missing coordinates and wrong field/document/session, mounts
`description` plus `notes` on one document, verifies both converge, unmounts
`description`, and verifies `notes` stays live (R-BIND-3). A kill/restart test
destroys the real server, restarts it over the same `onStoreDocument`
checkpoints, and reproduces the document.

## Scope notes (review r1)

- F2 awareness delivery and F6 composition convergence are witnessed at the
  api level (`api/tests/api/canvas-live-composition.test.ts`); IME coverage
  remains CL-3/DS evidence.
- The planned e2e provider-switch witness is deleted (review r1 item 5): the
  shell smoke could not detect provider regressions, and the
  provider-switch behavior (two fields mounted, one disposed, survivor live)
  is now witnessed against both providers by the harness suite.
- Reconnect/catch-up replay is witnessed with real Yjs bytes above the 256 KiB
  MCP cap through the pre-apply path
  (`api/tests/api/canvas-live-security.test.ts`), not simulated.

## Gates retained

- Published CL-1M/CL-2 validators replace the host provisional shapes at the
  adapter boundary before production conformance is claimed (H3 gate).
- Validated-bridge-only contingency applies if the pinned receive path cannot
  enforce the pre-apply boundary; raw-update admission stays disabled.
- Full B8 live adoption belongs to H8/H10.
