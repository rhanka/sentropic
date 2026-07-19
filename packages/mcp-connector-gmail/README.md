# @sentropic/mcp-connector-gmail

BR-72 Wave-1 benchmark proof: a Sentropic-owned, independently recoded, READ-ONLY `AppConnectorProviderAdapter` implementation for Gmail (validates the BR-72 matrix §7 read-only rows), backed entirely by in-repo SYNTHETIC fixtures with no real network calls. It is NOT the production connector — the production connector's residence is an architect D4 decision, deferred.

The root entry (`.` / `src/index.ts`) stays READ-ONLY and FROZEN.

## EXPERIMENTAL write surface (BR-72 Wave-2 Lot 3)

`./experimental` (`src/experimental.ts`) adds a MUTATION-capable write surface: 8 write tools — `send_email`, `create_draft`, `update_draft`, `delete_draft`, `create_label`, `add_label_to_email`, `move_to_trash`, `create_filter` — selected as the write-surface pattern-establisher for Wave 2 (see `spec/br72/WAVE2_WRITE_PLAN.md` §2.3/§3 Lot 3). Every write tool declares `mutatesExternalSystem: true` and `idempotency: { required: true, scope: 'principal' }`; the two destructive/external tools (`send_email`, `delete_draft`) additionally declare `gates.requiresHumanConfirmation: true`. Every invocation routes through `@sentropic/mcp-platform`'s guarded mutation path (`assertMutationGate` via `invokeGuardedTool`, `../mcp-platform/src/experimental/mutation-gate.ts`) BEFORE any mutation runs — an invocation missing its gate or idempotency key is rejected fail-closed. Synthetic fixtures only; no real network call. This EXPERIMENTAL surface is published but NOT frozen (no semver guarantee), mirroring `@sentropic/mcp-platform`'s own root/experimental split.

