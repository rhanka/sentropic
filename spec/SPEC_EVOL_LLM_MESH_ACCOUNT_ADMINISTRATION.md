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
and credential records, removes the index entry, clears in-memory selection
state, and makes future acquisition impossible. Before cleanup starts, the
service persists an owner-scoped removal tombstone. That barrier remains after
cleanup so a partial keyring failure, a process restart, or an already-running
credential refresh cannot make the account selectable or persist it again.
The same owner may retry an interrupted removal idempotently. A later,
successfully completed OAuth enrollment for the same account identifier is the
only operation that clears the barrier.

An acquisition that returned before removal may finish with the credential it
already received; local deletion cannot revoke a copied upstream token. Its
completion and outcome recording must not recreate durable account state.

## Verification

A deterministic facade test seeds two owner scopes in an in-memory keyring and
proves public projection, owner isolation, foreign-owner refusal, durable
deletion, and immediate acquisition refusal after removal. Additional
deterministic regressions inject a keyring deletion failure followed by a
service restart, and pause a token refresh across removal, proving both paths
remain fail-closed and leave no selectable account.
