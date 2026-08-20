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
state, and makes future acquisition impossible.

## Verification

A deterministic facade test seeds two owner scopes in an in-memory keyring and
proves public projection, owner isolation, foreign-owner refusal, durable
deletion, and immediate acquisition refusal after removal.
