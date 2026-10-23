# Migration inventory (L0, immo #861)

What the 0.2.0 contract line changes per ask, what migrates, and what is
awaited. The section 3.2 host API names are frozen against spec r2; this
file freezes shapes, rules and quarantine behavior only.

## Ask 1 — selection and effective profile

- New: explicit selection plus compiled immutable profile driving schema
  generation, validation, normalization, defaults, command hashing and
  runtime limits (shapes in `l0-freeze/profile-contract.ts`).
- New: effective-command and command-identity shapes with a versioned codec
  (shapes in `l0-freeze/command-identity-contract.ts`).
- Migration: callers pass selection up front; missing selection fails
  construction instead of implying all fifteen tools. Caller `paramsHash`
  and caller scope fields leave the effective schema. The candidate path
  restrictions (1024-byte ceiling, `:` and DEL prohibition) move into
  schema, shared validation, migration notes and consumer fixtures.
- Awaited (Q0): scope/subject domain examples, Unicode/whitespace/order
  vectors, file-order cases, existing host path-policy deltas.

## Ask 2 — host authorization inside durable finalization

- New: immutable invocation context, typed allow/deny decision and the
  atomic finalization unit with the frozen phase order (shapes in
  `l0-freeze/commit-contract.ts`).
- Type gate: `npm run freeze-types` runs tsc-strict over `l0-freeze/`,
  including the in-file compile-time assertions (opaque forgery rejection,
  callable coordinator operations, wired validators, ordinary-failure
  distinction). Promotion to `src/server/*` in L1/L3/L6 brings the standard
  make typecheck/lint coverage; the tsconfig `rootDir: src` constraint keeps
  the L0 freeze outside `src/` until then.
- Migration: `createHttpArtifactApp`, `createPublicationService`, custom
  ensure implementations and PostgreSQL stores adopt the coordinator role
  in L3-L5. No 0.1.x-compatible callback-only patch can claim this guarantee.
- Legacy records: preserve data, identify the old record format, quarantine
  ambiguous replay entries and return a stable unavailable/migration
  condition without allocating a replacement operation under another key.
  Only records with valid-success provenance and reconstructible command
  identity migrate for replay. Historical array order is not reconstructible
  from the sorted manifest. Radar supplies the pilot-state inventory; no
  automatic SQL/S3 retraction happens upstream.

## Ask 3 — typed causes before HTTP conversion

- New: internal discriminated outcome with category, public code, HTTP
  status, retriable flag, invocation/operation/phase correlation, commit
  state and private cause (shapes in `l0-freeze/failure-contract.ts`).
- Migration: S3 timeout and connection loss project to
  503/`capability_unavailable`; genuine lock conflict stays
  409/`conflict`; commit denial keeps the sanitized host refusal. The MCP
  unknown-failure retry change is documented in the 0.2.0 line.
- Private causes, stacks, SQL, endpoints, bucket names, storage IDs and
  credentials never enter HTTP bodies, MCP text/structuredContent or `_meta`.

## Ask 4 — publication and receipts

- Release train: L0–L8 topic PRs target `feat/artifacts-861-integration`,
  never main; a single integrator rebases/merges reviewed topics into that
  branch, no cherry-picks, no premature main merge. Main-only OIDC publish
  predicates stay intact. The integration owner serially reserves and adds
  the next pack-only `0.2.0-dev.N` / `0.22.0-dev.N` version commit to each
  source-changing topic; no two lanes edit manifests or locks. These
  versions exceed the registry baseline and are never published. No
  candidate registry publication happens in L0. Final stable manifests
  are packed on the integration branch in L8; only L9 merges to main after
  the owner's publish GO, triggering stable publication under the default
  tag. L0 changes no package version: the mesh peer range
  (`>=0.1.3 <0.2.0`) stays frozen until L7.
- Consumer baseline: Radar artifacts **0.1.2** (API and artifacts-host pins
  and lock), upstream source **0.1.4**; immo-mcp mcp-auth **^0.1.0** migrates
  to the exact qualified **0.2.x** (target 0.2.2, lock regenerated under
  strict install); llm-mesh **0.19.2** peer solution is
  `0.19.2 || >=0.22.0 <0.28.0`, owned by L7 — untested 0.20/0.21 releases
  are not implied and Radar's LLM behavior is not silently upgraded.
  Published 0.1.4 is the predecessor, not the Radar baseline.
- Radar rename handoff (spec r2 section 3.2): replace the
  `host.setFinalizeAuthorization` existence probe with a compile-time
  `ArtifactInvocationContext.authorizeCommit` binding plus a behavioral
  assertion that the callback receives the transaction after the barrier;
  replace `host.app.takeTypedCause` with `host.execute(request, invocation)`
  (or its delegate `host.app.execute`) and assert `outcome.ok === false`
  plus `outcome.failure.cause`, category and invocation ID before
  projection. Keep `host.selectedCapabilities` but assert the frozen
  four-name value and profile digest, not a truthy property. Missing
  exports remain `[missing-contract]`; the absence of the two retired
  slots must never produce that diagnostic.
- Acceptance revisions (Radar commit
  `71f41b723219999646b1a16c9c7e1810684b7526` unless noted):
  `api/tests/integration/artifacts-commit-probe.spec.ts`
  (`9b0f7e0d…f8faf`), `api/tests/integration/artifacts-mcp-adapter.spec.ts`
  (`e5e3b4d1…f1c8e`), `packages/artifacts-host/src/commit-authorization.test.ts`
  (`fc5709f1…8d0d88`), `packages/artifacts-host/src/commit-failures.test.ts`
  (`77fcfe4b…1c38c84`), `packages/artifacts-host/src/mcp-app-adapter.test.ts`
  (`982e8e63…51b7b8`), draft
  `api/tests/integration/artifacts-provider-acceptance.spec.ts`
  (`383192e6…9d68bd`). Pending Q1/Q2 delivery:
  `artifacts-finalization-authorization` and `artifacts-provider-failures`
  suites — record commit + SHA-256 on delivery; L8 cannot report their
  coverage as passed until pinned.
- Awaited (Q0/Q3/Q4): trusted `storageScopeId` injection evidence, prior
  key behavior, pilot-state inventory for legacy quarantine, and the Q3
  cross-process/restart/sixteen-tool parity suite. No automatic SQL/S3
  retraction happens upstream.
