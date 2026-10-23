# CI seats — five-CLI envelope and source contract (L0a)

Status: lot L0a implementation, synthetic first. Source: spec v9 section 8,
branch `feat/ci-seat-contract`, `ENV=test-ci-seat-contract`.
Owner decisions binding: Q1=A, Q2=A with easy re-enrollment, Q3=B no GitHub Pro;
seats only, never per-token API cost. No live provider call in this lot.

## Frozen interfaces

`packages/llm-mesh/src/enrollment/seat-bundle.ts` freezes `SeatBundleV1`:

- Identity: `schemaVersion` 1, opaque `seatRef`, `refreshFamilyRef`
  (absent for static keys), verified `ownerScope`, `cli`, layer-qualified
  `packageProviderId`, opaque `issuingClientRef`, `endpointFamily`,
  `credentialFormatVersion`, `nativeCliVersion`, `os`.
- Provenance: `enrollmentSource: 'cli'`, verified `accountBinding`,
  `entitlementClass`. A later `--from token` delivery preserves that source.
- Authority: `custodian`, `consumer`, `native-store`. Authority comes from the
  trusted channel, never from bundle data: a claim above the granted channel
  (`consumer` < `native-store` < `custodian`) is an escalation, decided through
  `resolveEffectiveAuthority`. `native-store` accepts `store-reference` with no
  refresh authority; `consumer` never carries renewable material or canonical
  payloads.
- Credential classes: `renewable`, `static-key`, `access-only`,
  `store-reference`. Non-custodian payloads carry no refresh authority,
  no renewable class and no canonical material.
- Lifecycle: `epoch`, monotonic `generation`, `operationId`, `issuedAt`,
  `providerExpiry`, separately named `localExpiryPolicy`, `refreshAuthority`.
  Reimporting N is idempotent; N-1 fails; a new epoch needs the controlled
  replacement operation. Unknown expiry is not infinite validity.
- Private payload: canonical material lives only in custodian bundles.
  `nativeUse` and `meshUse` hold access material or a verified static key,
  or an explicit `unavailable` marker for serialized-only support.
- Static failure categories: `schema-mismatch`, `size-exceeded`,
  `owner-mismatch`, `client-mismatch`, `stale-generation`, `unknown-field`,
  `refresh-material-present`, `nested-refresh-field`, `authority-escalation`,
  `invalid-lifecycle`, `generation-conflict`, `epoch-replacement-required`.
  Lineage classifies each import as `idempotent`, `forward`, `stale`,
  `epoch-replacement-required` or `conflict`; only `idempotent` and `forward`
  proceed without a controlled operation. Receipts carry metadata only.
- Size bound: each serialized bundle must fit the 48 KiB secret limit,
  measured in UTF-8 bytes.

The contract is exported through `@sentropic/llm-mesh/node` only;
no browser export of native readers exists in this lot.

## Layer-qualified provider mapping

Package enrollment keeps existing identifiers; agy enrolls as `cloud-code`.
The application receiver translates agy to `antigravity` transport,
`cloudcode-pa` target, `productAccountSource: antigravity`.
Application `cloud-code` transport targets `gemini` and is refused for agy;
`SEAT_AGY_APPLICATION_TUPLE` freezes the accepted tuple. No global
identifier unification and no Gemini substitution happen here.

## Per-CLI supported / unverified table (L0a exit state)

| CLI | Envelope + synthetic tests | Native profile observed | Lifecycle qualified |
| --- | --- | --- | --- |
| agy | supported | UNVERIFIED — P-AGY | UNVERIFIED — L0b |
| codex | supported | UNVERIFIED — P-CODEX | UNVERIFIED — L0b |
| vibe | supported | UNVERIFIED — P-VIBE | UNVERIFIED — L0b |
| muse | supported | UNVERIFIED — P-MUSE | UNVERIFIED — L0b |
| claude | supported | UNVERIFIED — P-CLAUDE | UNVERIFIED — L0b |

Native format inspection moves to L1-local after its adapters and
`src/node/cli-seat-store-reader.ts`; lifecycle claims move to L0b.
L0a finishes with native facts explicitly unverified.

## L0a Make gates

```bash
make test-llm-mesh SCOPE=tests/enrollment/seat-bundle.test.ts ENV=test-ci-seat-contract
make typecheck-llm-mesh lint-llm-mesh test-llm-mesh ENV=test-ci-seat-contract
```

## One-command enrollment surface (L3, from spec section 6.2, not implemented in L0a)

```bash
make seat-reenroll CLI=<cli>            # agy | codex | vibe | muse | claude
make seat-replace SEAT_REF=<ref> CLI=<cli>
make seat-reenroll-all
make seat-local-probe CLI=<cli>
make test-ci-seats SCOPE=<file> ENV=test-ci-seat-contract
```

agy re-enrollment goes through the official CLI flow or a profile snapshot.
These targets are recorded here for the UAT walkthrough; their implementation
belongs to a later lot.

Package-only gates expose no API/UI/Maildev ports and need no service slot.
API tests, UI tests and E2E are N/A in this lot. UAT is a credential-free
walkthrough of five synthetic labels, static errors, metadata-only receipts
and the one-command enrollment instructions.

## Reserved downstream exception

CISEAT-EX3 (owner-machine native Node helper) is recorded in `BRANCH.md`
for L1 local inspect and L3 re-enroll use. It grants no host execution
or forbidden-path edit in this synthetic lot.

## L1 — CLI/token import and external refresh policy (branch `feat/ci-seat-import`)

Source modes: `h2a llm-mesh account enroll <provider> --from cli|token`
(`codex`, `mistral-vibe`, `muse`, `claude-code`; agy enrolls as package
`cloud-code`). `--from cli` parses a privately materialized
provider-shaped profile plus a trusted manifest; `--from token` parses a
serialized envelope read over bounded stdin/FD/SDK stream, never argv.
Both modes parse and validate only: no provider exchange, mint, hidden
store reread, or refresh. Consumer authority never upgrades via bundle
data; `SeatBundleV1` lineage stays idempotent on N, forward-only on N+1.

Agy layer mapping is explicit: package `cloud-code` enrollment and
`accountTransport` translate at the application receiver to `antigravity`
transport, `cloudcode-pa` target, `productAccountSource: antigravity`.
Application `cloud-code`/`gemini`, mixed tuples, and wrong clients are
refused before any persistence, acquisition, or provider call, with zero
`importAntigravityEnrollment` routing and no Gemini substitution.

External refresh policy (`seatExternalPolicy` row/payload marker,
fail-closed on malformed markers) is read ahead of every acquisition
refresh hook in `acquireDbAccountTransport`: external rows skip all five
per-transport hooks, serve valid unexpired access directly, and classify
expiry as `access-unavailable` while retaining `token_secret`, owner,
lineage, and policy for the next projection. Muse device-flow grants
never refresh by re-reading the CLI login store. The delivery receiver
(`POST /import`, `GET /ack`, `POST /drain|/reopen`, conditional
CISEAT-EX2) imports monotonically with billing clearance, wrong-owner and
stale-generation refusal. Identity (owner, scope, billing) is derived
from the authenticated server registry, never the request body; the
presented credential is verified with a constant-time comparison; the
trusted-hop marker is per-request, never process-wide; k8s mTLS
termination stays with L3 P-DEPLOY. Mesh `importSeatBundle` is the
single canonical registry (`seat-<cli>-<seatRef>`): it validates
consumer authority, owner, and expiry, classifies idempotent/stale/
conflict/epoch transitions, and persists through the canonical
register/persist path so restart keeps the external marker. CLI seat
profiles require a custodian-observed `issuedAt` (never invented);
missing, empty, or unparseable expiry is unavailable, never infinite
validity. L1-local owner inspection uses
`src/node/cli-seat-store-reader.ts` through `seat-tools/seat-inspect`
(CISEAT-EX3, synthetic-gated, categories only), with an explicit
sidecar file backend or an `unverified` verdict.

After the 2026-10-23 main integration, mesh stays at 0.27.x inside
gateway 0.21.0's declared `^0.27.0` range (candidate mesh 0.27.1)
(R6-1); the workspace lock holds exactly one linked `llm-mesh` copy.
Shared refresh single-flight stays process-local; cross-runner authority
is the central exclusion plus pending state (recorded for L3 §3.4).

Gates: `make test-llm-mesh SCOPE=tests/enrollment/cli-seat-import.test.ts
ENV=test-ci-seat-import` (repeat per edited package file),
`make typecheck-llm-mesh lint-llm-mesh test-llm-mesh
ENV=test-ci-seat-import`, `make up-api-test` then
`make test-api-unit SCOPE=tests/unit/llm-seat-projection-import.test.ts`
(+ `llm-account-transports`, `llm-seat-delivery-auth`)
`make test-api-endpoints SCOPE=tests/api/llm-seat-delivery.test.ts`
`make typecheck-api lint-api` and `make test-api`, all with
`API_PORT=9580 UI_PORT=5780 MAILDEV_UI_PORT=1680` and `ENV` last.
