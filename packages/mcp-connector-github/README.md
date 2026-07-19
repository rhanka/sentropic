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

## LIVE surface (BR-72 DEPTH Lot 1) — known limitations

`src/live-executors.ts` / `src/live-adapter.ts` / `src/live-broker.ts` prove one connector
invoking the REAL `https://api.github.com` REST API end-to-end (see the module docblocks for
scope). Two limitations are DELIBERATELY out of scope for this proof and are documented here
rather than silently left implicit:

- **N1 — pagination.** `search_repositories` and `get_repository`/`get_file_contents` only
  ever fetch the FIRST page of a paginated GitHub endpoint. There is no `page`/`per_page`
  input, and no `Link`-header follow-up. A caller relying on this live surface for a query
  with more results than fit on one page will silently see a truncated result set (GitHub
  itself reports `total_count` in the search response; this connector does not act on it).
- **N5 — unauthenticated smoke, low rate limit.** `make smoke-mcp-connector-github-live`
  (`scripts/smoke-github-live.mjs`) runs WITHOUT a token unless `GITHUB_TOKEN` is set in the
  environment, so it shares GitHub's unauthenticated rate limit of **60 requests/hour per
  source IP** with every other unauthenticated caller from the same network. It is a MANUAL
  make target only (never wired into CI) for exactly this reason — running it repeatedly in a
  short window, or alongside other unauthenticated GitHub API usage from the same IP, can
  exhaust the quota and turn a real failure into a transient 403/429 (see S2 in the fix log
  below, now correctly reported as `retriable: true`).
