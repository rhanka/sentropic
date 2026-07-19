# @sentropic/mcp-connector-github

BR-72 Wave-1 benchmark proof: a READ-ONLY GitHub connector adapter recoded independently
against the `@sentropic/mcp-platform` `AppConnectorProviderAdapter` contract and unit-tested
against in-repo SYNTHETIC fixtures (no real network call, no secrets, no PII). This validates
the BR-72 matrix §7 github read-only rows — it is NOT a shipped production connector, and the
production connector's residence is an architect D4 decision, deferred.

The root entry (`.` / `src/index.ts`) stays READ-ONLY and FROZEN.

## EXPERIMENTAL write surface (BR-72 Wave-2 Lot 1)

`./experimental` (`src/experimental.ts`) adds a MUTATION-capable write surface: 7 write
tools — `create_repository`, `create_issue`, `update_issue`, `create_or_update_file`,
`delete_file`, `dispatch_workflow`, `delete_repository` — selected as the write-surface
pattern-establisher for Wave 2 (see `spec/br72/WAVE2_WRITE_PLAN.md` §2.1/§3 Lot 1 for the
full 66-capability github matrix this subset is drawn from). Every write tool declares
`mutatesExternalSystem: true` and `idempotency: { required: true, scope: 'principal' }`;
the two destructive/irreversible tools (`delete_file`, `delete_repository`) additionally
declare `gates.requiresHumanConfirmation: true`. Every invocation routes through
`@sentropic/mcp-platform`'s guarded mutation path (`assertMutationGate` via
`invokeGuardedTool`, `../mcp-platform/src/experimental/mutation-gate.ts`) BEFORE any
mutation runs — an invocation missing its gate or idempotency key is rejected fail-closed.
Synthetic fixtures only; no real network call. This EXPERIMENTAL surface is published but
NOT frozen (no semver guarantee), mirroring `@sentropic/mcp-platform`'s own root/experimental
split.

`create_or_update_file` carries a documented UPSERT/COMPOSITE gap: OOMOL treats it as one
composite action, but the Sentropic `Mutability` enum is closed with no composite member.
See the comment above its declaration in `src/write-manifest.ts` for the resolution.
