# @sentropic/comments

Collaborative annotation (comments and threads) over messages, canvas, artifacts,
fields and records for Sentropic-compatible apps.

This package owns the comment domain model, pure-TS type guards, the
`CommentStore` port, an in-memory reference adapter, a reusable Hono router, and
a transport-agnostic comment lifecycle event taxonomy. Persistence,
identity/authorization, assignee membership validation, and realtime transport
stay behind injected host ports so the package can run with either
Postgres-backed app adapters or the deterministic in-memory adapter. The package
does not import an application database or schema.

## Surface

- Domain types: `Comment`, `CommentTarget`, `CommentAuthor`, `CommentState`,
  `NewComment`, `TargetQuery`, `CommentThreadSummary`.
- Wire events: `CommentEvent`, `CommentEventType`, `CommentEventSink`, plus an
  `EventEnvelope<CommentEvent>` wrapper (from `@sentropic/contracts`).
- Port: `CommentStore` (tenant-scoped on every signature).
- Reference adapter: `InMemoryCommentStore`.
- Pure-TS guards: `isComment`, `isCommentTarget`, `isCommentEvent`,
  `isCommentThreadSummary` (no `zod` dependency).
- Hono subpath: `@sentropic/comments/hono` exports `createCommentsRouter` and
  the injected store, event, tenant, and authorization port contracts. Only
  this HTTP subpath uses Hono and Zod.

## Target round-trip

The generic `CommentTarget` maps the live `{ contextType, contextId, sectionKey }`
shape with no loss in either direction:

| Live field | -> `CommentTarget` | <- back to live |
|---|---|---|
| `contextType` in `{organization, folder, initiative, matrix, executive_summary}` | `kind: 'record'`, `recordType: <contextType>` | `contextType := target.recordType` |
| `contextId` | `id` | `contextId := target.id` |
| `sectionKey` (nullable) | `sectionKey?` (preserved verbatim) | `sectionKey := target.sectionKey ?? null` |

`message`, `canvas`, `artifact` are new annotation target kinds (no live
`contextType` today); each carries the optional `sectionKey` for sub-targets.

## Thread semantics

The model is **flat**: a thread is an ordered list of rows sharing a `threadId`
(no `parentId`). The root row mints the `threadId`; replies inherit it. Ordering
is `createdAt ASC` with an `id ASC` tiebreaker for determinism.

- `edit(content)` is **per-row** (content-only).
- `delete(id)` is a **per-row hard delete**; deleting the root leaves surviving
  replies, and the thread identity is the surviving set of rows (root recomputed
  as the earliest surviving row).
- `setState` (open/resolved) and `assign` **cascade** across every row sharing
  the `threadId` (thread-level semantics).

Authorization, assignee workspace-membership validation, and identity resolution
are **host** concerns — the package stores opaque author/assignee ids and never
authenticates or validates membership.

## Wire-event mapping (host bridges transport)

The package emits structured `CommentEvent`s on every mutation; the host maps
them to its transport (e.g. Postgres `NOTIFY comment_events` / SSE
`comment_update` / WebSocket). The package never imports `pg`.

| package `CommentEventType` | live NOTIFY `data.action` | live source |
|---|---|---|
| `created`    | `created`    | comments POST |
| `updated`    | `updated`    | comments PATCH (content or REST assignment) |
| `resolved`   | `closed`     | comments close / tool-service close |
| `reopened`   | `reopened`   | comments reopen |
| `deleted`    | `deleted`    | comments DELETE |
| `reassigned` | `reassigned` | tool-service AI reassign |

The package `assign()` emits `reassigned`. A host wiring `assign()` to the REST
assignment path MAY instead surface `updated` for backward parity; both are live
actions. The state vocabulary is `open|resolved` in the package, mapping the live
`open|closed` 1:1 (`resolved` <-> `closed`).

The `EventEnvelope.redactedFields` marker is a pass-through only — the package
performs NO redaction or masking.
