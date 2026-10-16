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

Package-only gates expose no API/UI/Maildev ports and need no service slot.
API tests, UI tests and E2E are N/A in this lot. UAT is a credential-free
walkthrough of five synthetic labels, static errors, metadata-only receipts
and the one-command enrollment instructions.

## Reserved downstream exception

CISEAT-EX3 (owner-machine native Node helper) is recorded in `BRANCH.md`
for L1 local inspect and L3 re-enroll use. It grants no host execution
or forbidden-path edit in this synthetic lot.
