# Migration inventory (L0, immo #861)

What the 0.2.0 contract line changes per ask, what migrates, and what is
awaited. Public host API names stay unfrozen until spec r2; this file
freezes shapes, rules and quarantine behavior only.

## Ask 1 — selection and effective profile

- New: explicit selection plus compiled immutable profile driving schema
  generation, validation, normalization, defaults, command hashing and
  runtime limits (shapes in `src/profile-contract.ts`).
- New: effective-command and command-identity shapes with a versioned codec
  (shapes in `src/server/command-identity-contract.ts`).
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
  `src/server/commit-contract.ts`).
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
  state and private cause (shapes in `src/server/failure-contract.ts`).
- Migration: S3 timeout and connection loss project to
  503/`capability_unavailable`; genuine lock conflict stays
  409/`conflict`; commit denial keeps the sanitized host refusal. The MCP
  unknown-failure retry change is documented in the 0.2.0 line.
- Private causes, stacks, SQL, endpoints, bucket names, storage IDs and
  credentials never enter HTTP bodies, MCP text/structuredContent or `_meta`.

## Ask 4 — publication and receipts

- L0 reserves `0.2.0-rc.1` for the artifacts source line after registry
  verification (published `0.1.4` is the predecessor). No publish happens
  in L0. Final compatible peer ranges and the logical provider version
  match the exact released archives in L9.
