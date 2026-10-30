# H3 validated ingress and real Hocuspocus provider witness

Scope: approved host plan r3 H3 only (lines 116-135, lot table line 49).
Plan SHA-256: `a48f54be6ce82b05e697f1c3f7dbc433ed60b69f5c2e377b6fb71faad9ababe7`.
Frozen DS specification SHA-256: `161c5dac35d1cfe6b4a1937fe2f38f900e3f73d24cbae1cbb802b4036ee36834`.
Base: `origin/main` at `8ea119c4d`; H0 #823, H1 #830, H2 #833 merged.

No application consumer is switched. No second `CanvasTemplateDescriptor`,
collaboration vocabulary, schema generator, or editor code is published (DS-owned).
`migrated 0/24`.

## Dependency closure

| Package | Pinned version | Source |
| --- | --- | --- |
| `yjs` | `13.6.27` | `api/package.json` devDeps, lockfile |
| `y-protocols` | `1.0.7` | DS CL-3 pin (`7a75a861`), adapter-conformant candidate |
| `@hocuspocus/server` | `4.7.1` | Frozen spec section 2.5 candidate, adapter-conformant |
| `@hocuspocus/provider` | `4.7.1` | Frozen spec section 2.5 candidate, adapter-conformant |

`HocuspocusHost` exposes `onAuthenticate`, `onLoadDocument`, and `handleUpdate`
with the same hook shape as `@hocuspocus/server`. Raw Hocuspocus ingress stays
disabled; every update passes framing, admission, classification, and
resulting-schema validation before any authoritative application, durable
journal commit, or broadcast. Full `yjs`/`y-protocols`/`@hocuspocus/*`
production install lands with H10 production wiring.

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
Quarantined input never enters the journal or reaches replicas.

`hocuspocus.ts` closes the connection after repeated hostile updates
(threshold 3, configurable) and immediately on revoked actors or
wrong-document submissions; closure never applies queued input.

## RED and GREEN evidence

| Witness | Observed RED | Observed GREEN |
| --- | --- | --- |
| Sync framing: 1 MiB frame cap, 8 MiB logical cap, no truncation, partial refusal, >256 KiB catch-up framed | 1 failure (missing module) | 5 passed |
| Ingress: reserved meta, foreign field/meta, unsupported marks/embeds, R-LIN-4 acceptance, duplicates, first-separator, stale vector | 1 failure (missing module) | 7 passed |
| Quarantine: retention, revalidation on arrival, refusal without leak, duplicate ids | 1 failure (missing module) | 4 passed |
| Hocuspocus witness: full `handle.identity` resolution, R-BIND-3 two fields, fail-closed coordinates, pre-apply validation | 1 failure (missing module) | 3 passed |
| Hostile ingress: cases i-v, vii reconnect replay shape, no applied entry, no broadcast, revoked close | 1 failure (missing module) | 6 passed |

Measured totals: **25 tests passed** (framing 5, ingress 7, quarantine 4,
hocuspocus 3, security 6). RED results are missing-module import errors on the
five new files, observed before implementation in the isolated tools runner.

## Offline harness for DS witness 8(i)

Package: `api` (`api/src/services/canvas-live/harness.ts`).
Make command (offline, no network services, under the Docker lock):

`make -f /home/antoinefa/src/sentropic/.tmp/canvas-h3-host.mk h3-test TOOLS_ARGS="vitest run tests/unit/canvas-live-sync-framing.test.ts tests/unit/canvas-live-ingress.test.ts tests/unit/canvas-live-quarantine.test.ts tests/api/canvas-live-hocuspocus.test.ts tests/api/canvas-live-security.test.ts" ENV=test-canvas-h3`

The harness resolves bindings by full `handle.identity`, fails closed on
missing coordinates and wrong field/document/session, mounts `description`
plus `notes` on one document, verifies both converge, unmounts `description`,
and verifies `notes` stays live (R-BIND-3). Invoke
`runOfflineHarness` then `assertHarnessForDsWitness8` for the DS CL-3 gate.

## Gates retained

- Published CL-1M/CL-2 validators replace the host provisional shapes at the
adapter boundary before production conformance is claimed (H3 gate).
- Validated-bridge-only contingency applies if the pinned receive path cannot
enforce the pre-apply boundary; raw-update admission stays disabled.
- E2E provider-switch spec (`e2e/tests/canvas-live-provider.spec.ts`) is a
public shell smoke; full B8 live adoption belongs to H8/H10.
