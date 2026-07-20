# @sentropic/mcp-connector-googledrive

BR-72 Wave-1 benchmark proof: a READ-ONLY Google Drive connector adapter recoded
against the `@sentropic/mcp-platform` `AppConnectorProviderAdapter` contract and
unit-tested against in-repo SYNTHETIC fixtures (no real network call, no secrets,
no PII). This is NOT a shipped production connector — the production connector's
residence is an architect D4 decision, deferred.

The root entry (`.` / `src/index.ts`) stays READ-ONLY and FROZEN.

## EXPERIMENTAL write surface (BR-72 Wave-2 Lot 2)

`./experimental` (`src/experimental.ts`) adds a MUTATION-capable write surface: 6
write tools — `files.create`, `files.update`, `files.copy`, `permissions.create`,
`files.delete`, `drives.create` — selected as the write-surface pattern-establisher
subset for Wave 2 (see `spec/br72/WAVE2_WRITE_PLAN.md` §2.2/§3 Lot 2 for the full
23-capability googledrive matrix this subset is drawn from). Every write tool
declares `mutatesExternalSystem: true` and `idempotency: { required: true, scope:
'principal' }`; `files.delete` (destructive/irreversible) and `permissions.create`
(irreversible, security-sensitive authz-state change — granting external
sharing/access) additionally declare `gates.requiresHumanConfirmation: true`.
Every invocation routes through `@sentropic/mcp-platform`'s guarded mutation path
(`assertMutationGate` via `invokeGuardedTool`,
`../mcp-platform/src/experimental/mutation-gate.ts`) BEFORE any mutation runs — an
invocation missing its gate or idempotency key is rejected fail-closed. Synthetic
fixtures only; no real network call. This EXPERIMENTAL surface is published but
NOT frozen (no semver guarantee), mirroring `@sentropic/mcp-platform`'s own
root/experimental split.
