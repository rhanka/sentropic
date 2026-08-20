# LLM Mesh Account Administration

## Problem

The public facade enrolls local account transports but cannot enumerate or
remove them. Consumers therefore cannot provide a complete account lifecycle
without reading the private keyring or creating a second registry.

## Contract

`LlmMeshFacade` owns two additional operations:

- list public account metadata for one explicit `ownerScope`;
- remove one account by identifier for that same explicit `ownerScope`.

The public projection contains only `accountId`, `accountLabel`, `providerId`,
`status`, `createdAt`, and `updatedAt`. Credential envelopes, access tokens,
refresh tokens, provider metadata, keyring keys, and foreign-owner accounts are
never returned.

Removal fails with the same not-found result for an absent account and an
account owned by another scope. A successful removal deletes durable public
and credential records, clears in-memory selection state, and makes future
acquisition impossible. The credential-free account identifier remains in an
append-only discovery index: selection always validates the public record and
barrier generation, while never deleting the identifier avoids non-atomic
remove/re-enroll races in keyring adapters that do not expose compare-and-swap.
Before cleanup starts, the
service persists an owner-scoped removal tombstone. That barrier remains after
cleanup so a partial keyring failure, a process restart, or an already-running
credential refresh cannot make the account selectable or persist it again.
The same owner may retry an interrupted removal idempotently. A later,
successfully completed OAuth enrollment for the same account identifier and
owner is the only operation that supersedes that barrier generation. The
marker remains durable: old service instances compare their local account
generation with the persisted marker, discard stale credentials, and can then
restore the newly enrolled generation. An enrollment for another owner cannot
supersede the barrier or replace an active account with a colliding identifier.

An acquisition that returned before removal may finish with the credential it
already received; local deletion cannot revoke a copied upstream token. Its
completion and outcome recording must not recreate durable account state.

## Verification

A deterministic facade test seeds two owner scopes in an in-memory keyring and
proves public projection, owner isolation, foreign-owner refusal, durable
deletion, and immediate acquisition refusal after removal. Additional
deterministic regressions inject a keyring deletion failure followed by a
service restart, and pause a token refresh across removal, proving both paths
remain fail-closed and leave no selectable account. Cross-instance
re-enrollment, foreign-owner identifier collision, and enrollment/removal index
interleaving tests cover barrier generation coherence.
