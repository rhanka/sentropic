# SPEC_EVOL — `@sentropic/comments` (BR-42c) — SCOPING v2 (REVISED)

Status: SCOPING v2 — REVISED after double adversarial review (**Opus 4.8** + **Codex 5.5-xhigh**, CONVERGED). All decisions conductor-resolved (NO user decision pending). Decision-oriented; grounded in the live app's comment subsystem (read, not reinvented). After this → detailed `BRANCH.md` from `plan/BRANCH_TEMPLATE.md`.
Owner: `feat/comments-package` (BR-42c, the one genuinely-new module of the BR-42 family).
Baseline: `main` (fork the package work from `main`; this worktree is `feat/comments-package`).
Sources: `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` §2 (transverse contracts / `TenantContext`), §10.3 (canvas / `LiveDocumentStore`), §16.2 (decided: `comments` = dedicated package); `plan/42-BRANCH_chore-scale-build-app.md` (BR-42c finalité + dep graph). Grounded in live code (re-verified for v2): `api/src/routes/api/comments.ts`, `api/src/db/schema.ts` (`comments` table, lines 645-672), `api/src/services/tool-service.ts` (~1230-1400, thread-summary build + `reassigned` NOTIFY), `api/src/routes/api/streams.ts` (`comment_events` NOTIFY/`comment_update` SSE), `api/src/services/context-comments.ts` (AI resolution assistant + `CommentThreadSummary` type), `ui/src/lib/utils/comments.ts`.

## 0. Scope frame (what BR-42c IS and IS NOT)

BR-42c extracts a **new standalone package `@sentropic/comments`**: collaborative annotation over messages / canvas / artifacts / fields / records. It is **isolated** — the package imports **no Drizzle, no `pg`, no `api/` code**; the host supplies adapters.

- **IN scope (this lot)**: package skeleton mirroring published packages; domain model + pure-TS type guards; `CommentStore` port; an **in-memory reference adapter** proving the thread-level cascade contract; comment lifecycle **wire events** (transport-agnostic) with a documented mapping to the existing `comment_events` NOTIFY pattern; a `CommentThreadSummary` package surface (D9) so the host AI assistant is unblocked; standalone vitest suite; make targets + CI validate lane + first-publish bootstrap doc (`BR42c-EX1`).
- **OUT of scope (explicitly deferred)**:
  - **No live-`api`/`ui` change, and NO consuming-app activation in BR-42c.** Adopting the package inside `api/src/routes/api/comments.ts` (replacing the inline Drizzle handlers) AND wiring at least one app root to import it is a **separate deferred concern** — see **§8 Activation note** and **BR-42d** (`feat/persistence-comments-observability`). This is an acknowledged, plan-sanctioned exception to `rules/architecture.md` ("Package extraction must be activated by real app consumption"); see §8.
  - **Postgres adapter** (`CommentStore` over the real `comments` table) → belongs to `persistence-*` / **BR-42d**, NOT here.
  - **No UAT.** BR-42c finishes at recette / package-tests green (typecheck + unit + build + pack). No docker stack, no E2E, no browser.
  - Identity/auth resolution (who the author is, RBAC, **assignee workspace-membership validation**) → **host** (BR-39 `auth-hono`/`auth-ui` provide identities; live `ensureWorkspaceMember` gates assignment in `api`). The package consumes an opaque author/assignee identity, it does not authenticate or validate membership.
  - Presence / live cursors / unread-tracking UI → **host** (the live app already does this via `presence_events`; out of the annotation-domain package).
  - **Comment redaction / PII masking** → **does not exist in the live app** (grep-confirmed: no `redact*` token anywhere in `comments.ts`, `context-comments.ts`, or `schema.ts`). DEFERRED/DROPPED from BR-42c (see Decision D5 revised + §6).

Rationale for isolation (mirrors `contracts`/`events`/`chat-server` discipline, §7 anti-patterns): persistence package owns adapters, **domain stays in the consumer package**; the package must build with zero private/runtime deps so a downstream `build-app`-generated app can annotate without Postgres.

## 1. Grounding — how comments work in the app **today** (re-verified for v2, to reuse not reinvent)

Read from live code (do not re-derive a different model):

**DB (`api/src/db/schema.ts` lines 645-672, `comments` table)** — columns (verbatim):
`id` (pk), `workspaceId` (→ workspaces, cascade), `contextType` (notNull), `contextId` (notNull), `sectionKey?` (nullable), `createdBy` (→ users, cascade), `assignedTo?` (→ users, set null), `status` notNull default `'open'` (`'open'|'closed'`), `threadId` (notNull), `content` (notNull), `toolCallId?` (nullable), `createdAt` (notNull defaultNow), `updatedAt?` (defaultNow). Indexes on workspaceId, (contextType, contextId), threadId, assignedTo, status, toolCallId. **No `parent_id` column — the live model is FLAT** (thread = ordered list of rows sharing `threadId`).

**Target kinds today** (`contextTypeSchema` in `comments.ts:13`): `organization | folder | initiative | usecase | matrix | executive_summary`, with `// TODO Lot 10: remove 'usecase'`. CRITICAL: `ensureContextExists` (`comments.ts:30-56`) only resolves `organization | folder | matrix | executive_summary | initiative` — it **never handles `usecase`**, and the UI (`ui/src/lib/utils/comments.ts:3`) and AI assistant (`context-comments.ts:4`) both type `CommentContextType` WITHOUT `usecase`. So `usecase` is dead in the live surface; the package aligns with `initiative`, not `usecase` (Decision D2 revised). `sectionKey` carries the sub-target, e.g. `'description'`, `'matrix.cell.x.y'`. `toolCallId` ties a comment to an AI tool call (message/canvas provenance).

**Threading** (`comments.ts` POST, lines 148-207): first comment of a thread mints a `threadId` (`createId()`); replies pass `thread_id` and must reference an existing thread in the same (workspace, contextType, contextId) — else `404 'Thread not found'`. **Assignment and status are thread-level**: assigning/closing/reopening cascades an `UPDATE ... WHERE threadId = ...` across all rows sharing `threadId` (close: `comments.ts:278-281`; reopen: `309-310`; assign-on-create: `198-203`; assign-on-PATCH: `246-250`). Editing content is **per-row** (PATCH content-only path: `comments.ts:252`).

**Authorization & assignee validation** (host concern, NOT package): `requireWorkspaceCommenterRole()` to write, `requireWorkspaceAccessRole()` to read; edit/close/reopen/delete allowed to the **creator or a workspace admin** (`requireWorkspaceAdmin`); **`ensureWorkspaceMember(assignedTo, workspaceId)`** rejects assignment to a non-member (`comments.ts:177-179, 239-241`). The package must NOT embed RBAC NOR assignee-membership validation — it exposes operations; the host gates them (Decision G).

**Delete** (`comments.ts:316-339`): `db.delete(comments).where(and(eq(comments.id, id), eq(comments.workspaceId, ...)))` — a **per-row HARD delete** (no soft-delete column, no thread cascade on delete). Deleting one row removes only that row; remaining rows of the thread persist (Decision G).

**Wire/realtime** (`comments.ts` `notifyCommentEvent` + `tool-service.ts` `notifyCommentEvent` + `streams.ts`):
- Backend emits `NOTIFY comment_events, '<json>'` with payload `{ workspace_id, context_type, context_id, data: { action, comment_id | thread_id } }`.
- **`action ∈ { created, updated, closed, reopened, deleted, reassigned }`** — five from the REST route (`comments.ts`: created/updated/closed/reopened/deleted) PLUS **`reassigned`** from the AI tool-service resolution path (`tool-service.ts:1381`). Note: the REST PATCH assignment path emits `updated` (`comments.ts:254`), while the AI `reassign` action emits `reassigned` (`tool-service.ts:1381`) — BOTH are live wire actions and both are documented (Decision C).
- `streams.ts` LISTENs `comment_events`, gates by `shouldEmitWorkspaceEvent`, and pushes an SSE frame `event: comment_update` with `{ contextType, contextId, data }`.
This NOTIFY/SSE coupling is the transport the package's wire-events must **map onto** while staying transport-agnostic (the package emits structured events; the host wires them to PG NOTIFY / SSE / WebSocket).

**AI assistant** (`api/src/services/context-comments.ts` + `tool-service.ts:1230-1284`): a `comment_resolution_assistant` reads open threads (`CommentThreadSummary[]`) and proposes resolution actions (`close | reassign | note`). This is **host application logic** (uses `llm-runtime`, prompts); BUT the `CommentThreadSummary` shape it consumes is promoted to a **package surface** (Decision D9) so the host can rebuild it verbatim from the package without re-deriving field names.

## 2. Domain model (package-owned types)

All types pure TS + hand-written type guards (pure-TS posture, Decision D7-a; `zod` NOT taken as a dependency). Mirrors the live columns, generalised.

```ts
// Target the annotation points at. Generalises the app's (contextType, contextId, sectionKey)
// WITHOUT LOSS — see the round-trip table below (Decision A).
export type CommentTargetKind = 'message' | 'canvas' | 'artifact' | 'field' | 'record';
export type CommentTarget = {
  kind: CommentTargetKind;
  id: string;            // contextId / messageId / docId / artifactId
  sectionKey?: string;   // PRESERVED VERBATIM from the live column: 'description', 'matrix.cell.x.y',
                         // a livedoc range, or a field path. Optional on EVERY target kind (Decision A).
  recordType?: string;   // when kind==='record'|'field': the live host record kind
                         // (organization|folder|initiative|matrix|executive_summary). Opaque string (Decision D2).
};

export type CommentAuthor = {
  id: string;            // opaque host identity (users.id today; BR-39 identity later) — package never resolves it
  kind?: 'human' | 'agent' | 'nhi'; // forward-compat with §39h unified identities; default 'human'
  displayLabel?: string; // host-supplied denormalised label (optional; package does not join users)
};

export type CommentState = 'open' | 'resolved'; // maps to live 'open' | 'closed' (Decision D3)

export type Comment = {
  id: string;
  tenant: TenantContext;       // §2 transverse contract; carries tenantId/workspaceId/userId
  target: CommentTarget;
  threadId: string;            // root mints; replies inherit (live threadId semantics) — FLAT model, no parentId
  author: CommentAuthor;
  assignedTo?: CommentAuthor['id']; // host validates membership; package stores opaque id (Decision G)
  state: CommentState;
  body: string;
  provenance?: { toolCallId?: string; runId?: string }; // live toolCallId + run linkage (message/canvas origin)
  createdAt: string;           // ISO
  updatedAt?: string;          // ISO
};
```

**Target round-trip — explicit, lossless (Decision A).** The generic `CommentTarget` maps today's `{ contextType, contextId, sectionKey }` with NO loss in either direction:

| Live field | → package `CommentTarget` | ← back to live |
|---|---|---|
| `contextType ∈ {organization, folder, initiative, matrix, executive_summary}` | `kind: 'record'`, `recordType: <contextType>` | `contextType := target.recordType` |
| `contextId` | `id` | `contextId := target.id` |
| `sectionKey` (nullable) | `sectionKey?` (optional, preserved verbatim) | `sectionKey := target.sectionKey ?? null` |

The five live `contextType` values are all **host record kinds**, so they round-trip through `kind:'record'` + `recordType`. When the host annotates a single sub-field it MAY use `kind:'field'` + `sectionKey`, which round-trips identically (`field` is a host-chosen narrowing of `record`+`sectionKey`; both carry `recordType`). The package never enumerates the host record kinds (keeps it host-agnostic, Decision D2). `message|canvas|artifact` are the BR-42c-mandated NEW kinds (no live `contextType` today) and carry the optional `sectionKey` for sub-target ranges.

Notes / alignment:
- `tenant: TenantContext` (from `@sentropic/contracts`) replaces the bare `workspaceId` column at the API boundary; the **storage-level `tenantId`/`workspaceId`** requirement of §2 is satisfied by the adapter persisting `tenant.*`.
- `sectionKey` is the SAME name as the live column (no rename to `path`) — preserved as an optional field on every target kind, so the host maps it 1:1.
- `provenance.toolCallId` preserves the live `toolCallId` link (comment ↔ AI tool call) — verified-present column (`schema.ts:660`), not invented.
- **No `parentId`** (Decision F): the live model is flat (`threadId` only, no `parent_id` column); a thread is an ordered list of rows. `parentId` is rejected as speculative entropy for v0.1.0.
- **No `redactedFields`** on `Comment` (Decision E): no live comment redaction exists. Envelope-level `redactedFields` (from `@sentropic/contracts` `EventEnvelope`) stays a pass-through marker only; the package performs NO masking.

## 3. Port — `CommentStore` (+ in-memory reference adapter)

Single port, tenant-scoped on every signature (§2 mandate: "every cross-package call MUST carry `TenantContext`"; §3 threat: cross-tenant access mitigated by `TenantContext` in every port signature). Mirrors live operations (CRUD + list-by-target + thread + thread summaries + cascade state/assignment).

```ts
export interface CommentStore {
  add(tenant: TenantContext, input: NewComment): Promise<Comment>;             // mints threadId if no threadId given (live POST)
  get(tenant: TenantContext, id: string): Promise<Comment | null>;
  edit(tenant: TenantContext, id: string, patch: { body?: string }): Promise<Comment>; // PER-ROW content edit
  delete(tenant: TenantContext, id: string): Promise<void>;                    // PER-ROW HARD delete (live db.delete)
  listByTarget(tenant: TenantContext, query: TargetQuery): Promise<Comment[]>; // (contextType,contextId[,sectionKey][,status]) live filter; createdAt ASC, id tiebreaker
  listThread(tenant: TenantContext, threadId: string): Promise<Comment[]>;      // ordered createdAt ASC, id tiebreaker
  listThreadSummaries(tenant: TenantContext, query: TargetQuery): Promise<CommentThreadSummary[]>; // D9: feeds host AI assistant
  setState(tenant: TenantContext, threadId: string, state: CommentState): Promise<Comment[]>; // CASCADE close/reopen (thread-level)
  assign(tenant: TenantContext, threadId: string, assigneeId: string | null): Promise<Comment[]>; // CASCADE assign (thread-level)
}
```

- **`NewComment`** = `Comment` minus `id/threadId/createdAt/updatedAt/state` + **optional `threadId`** for replies (matches live "thread_id optional → reply to existing thread, else mint"). No `parentId` (Decision F).
- **`TargetQuery`** = `{ kind: CommentTargetKind; id: string; sectionKey?: string; status?: CommentState }` (mirrors the live `listQuerySchema`: context_type + context_id + optional section_key + optional status — `comments.ts:67-72`).
- **`CommentThreadSummary`** is a **first-class PACKAGE SURFACE (Decision D9)** — see §3bis for the verbatim shape.
- **Delete rule (Decision G).** `delete(id)` is a per-row hard delete (matches live `db.delete(comments).where(eq(id))`). Deleting the ROOT row does NOT delete the thread: remaining reply rows persist and the thread identity IS the surviving set of rows sharing `threadId` (`listThread`/`listThreadSummaries` recompute root = earliest surviving row by createdAt-then-id). Note: the host `COLLAB.md` "thread data removed" wording is a **HOST policy** (the host may choose to delete all rows of a thread); the **package contract is strictly per-row**.
- **Ordering (Decision G).** `listThread` and `listByTarget` order by `createdAt ASC` with an **`id` ASC tiebreaker** — deterministic, because the live `createdAt` (`timestamp`, `schema.ts:661`) is NOT unique (two rows can share a millisecond). The live route orders by `asc(comments.createdAt)` only; the package ADDS the id tiebreaker for determinism (a strict refinement, never a behaviour change for distinct timestamps).
- **Assignee (Decision G).** The package does **NOT** validate assignee workspace membership — it stores `assigneeId` opaque. The host gates `assign()` (live `ensureWorkspaceMember`). The package treats `assigneeId` as an arbitrary identity string (or `null` to unassign).
- **In-memory reference adapter** (`InMemoryCommentStore`): a `Map`-backed implementation enforcing tenant scoping (rows keyed/filtered by `tenant.tenantId` + `tenant.workspaceId`), thread minting, createdAt-ASC-then-id ordering, per-row edit/delete, and **thread-level cascade** for `setState`/`assign` (Decision H — this cascade IS the package's semantic contract and MUST be proven by tests). Ships alongside the port (§5 "Each port must have an in-memory reference adapter") so downstream builds need no Postgres. **Emits wire events** (§4) via an injected `CommentEventSink` (default = no-op / collecting sink for tests).
- **Postgres adapter is OUT of scope** → BR-42d / `persistence-*`. The package must compile and test with only the in-memory adapter.

## 3bis. `CommentThreadSummary` — package surface (Decision D9)

Promoted to a package-exported type with **VERBATIM live field names** so `api/src/services/context-comments.ts` (the AI resolution assistant) is NOT blocked and can be rebuilt without re-deriving names. Matches `tool-service.ts:1245-1284` (the build site) + `context-comments.ts:6-21` (the type) **exactly**:

```ts
export type CommentThreadSummary = {
  threadId: string;
  // Live carries BOTH `contextType` (string) AND the generalised `target`. The package exposes
  // `target: CommentTarget` as canonical; a host that wants the raw live name reads target.recordType.
  // For a drop-in match the package ALSO surfaces `contextType?: string` (= target.recordType) so the
  // existing assistant's normalizeThreadsForPrompt keeps working verbatim (Decision A round-trip + D9).
  contextType?: string;     // = target.recordType (live drop-in compat)
  target: CommentTarget;    // canonical generalised target
  sectionKey?: string;      // = target.sectionKey (live: row.sectionKey ?? null)
  rootMessage: string;      // live: root row content
  rootMessageAt: string;    // ISO; live: root createdAt
  lastMessage: string;      // live: latest row content
  lastMessageAt: string;    // ISO; live: latest createdAt
  messageCount: number;
  status: CommentState;     // package 'open'|'resolved' (maps live 'open'|'closed', Decision D3)
  assignee?: string;        // live: assignedTo ?? null — opaque id, package does not resolve label
};
```

- `CommentStore.listThreadSummaries(tenant, query)` returns `CommentThreadSummary[]`, computed by the in-memory adapter exactly as `tool-service.ts:1235-1283` does it (group by `threadId`, root = earliest, last = latest, count rows, status closed-if-any-closed→`resolved`, first non-null assignee).
- Field names `rootMessage/rootMessageAt/lastMessage/lastMessageAt/messageCount` are taken VERBATIM from the live type — NO renames (so the host assistant's `normalizeThreadsForPrompt` maps 1:1).

## 4. Wire events (transport-agnostic; mapped to the live `comment_events` pattern)

The package owns a comment **lifecycle event** union, emitted by the store on mutation. It is transport-agnostic: the host maps it to PG `NOTIFY comment_events` / SSE `comment_update` / WebSocket. The package never imports `pg`.

```ts
// 1:1 with the live wire actions: created|updated|closed|reopened|deleted|reassigned (Decision C).
export type CommentEventType =
  | 'created' | 'updated' | 'resolved' | 'reopened' | 'deleted' | 'reassigned';

export type CommentEvent = {
  type: CommentEventType;
  tenant: TenantContext;
  target: CommentTarget;
  commentId: string;
  threadId: string;
  data?: Record<string, unknown>;
};

export interface CommentEventSink {
  emit(event: CommentEvent): void; // sync; host bridges to NOTIFY/SSE/WS
}
```

**Mapping to the live channel** (documented in README, the package stays neutral). The package event type names are aligned to the live `data.action` values 1:1 (only `closed`→`resolved` differs, per the state-vocabulary Decision D3):

| package `CommentEventType` | live NOTIFY `data.action` | live source | live SSE |
|---|---|---|---|
| `created`    | `created`    | `comments.ts` POST | `comment_update` |
| `updated`    | `updated`    | `comments.ts` PATCH (content or REST assignment) | `comment_update` |
| `resolved`   | `closed`     | `comments.ts` close / `tool-service` close | `comment_update` |
| `reopened`   | `reopened`   | `comments.ts` reopen | `comment_update` |
| `deleted`    | `deleted`    | `comments.ts` DELETE | `comment_update` |
| `reassigned` | `reassigned` | `tool-service.ts:1381` AI reassign | `comment_update` |

**Assignment emits BOTH paths (Decision C, documented).** A REST assignment (PATCH `assigned_to`) emits the live `updated` action (`comments.ts:254`); the AI resolution `reassign` action emits `reassigned` (`tool-service.ts:1381`). The package's `assign()` emits `reassigned` (the assignment-specific type), and the README documents that a host wiring `assign()` to the REST path MAY instead surface `updated` for backward parity — both are live actions.

**Relationship to `@sentropic/events`** (Decision D6): `@sentropic/events` is a thin module owning only the chat-stream `StreamEvent` taxonomy (verified) — it does **not** host a generic domain-event registry. So comments **own their `CommentEvent` types** and (recommended) wrap them in `EventEnvelope<CommentEvent>` from `@sentropic/contracts` for `tenant`/`ts`/`seq`/`redactedFields` uniformity, **without** taking a dependency on `@sentropic/events`. The envelope's `redactedFields` is a PASS-THROUGH marker only — the package does NO masking (Decision E).

## 5. Boundary ledger (package owns vs host owns)

| Concern | Owner | Note |
|---|---|---|
| Comment domain types + pure-TS guards | **package** | `Comment`, `CommentTarget`, `CommentThreadSummary`, `CommentEvent` |
| `CommentStore` port + in-memory adapter | **package** | reference impl, tenant-scoped, thread-level cascade (Decision H) |
| `CommentThreadSummary` surface (D9) | **package** | verbatim live field names; feeds host AI assistant |
| Wire-event types + sink interface | **package** | transport-agnostic; mapping doc only |
| Persistence backend (Postgres over `comments` table) | **host adapter** (BR-42d) | OUT of scope |
| Identity / author resolution / RBAC / assignee membership | **host** | BR-39 identities; `requireWorkspace*Role` + `ensureWorkspaceMember` stay in api (Decision G) |
| Realtime transport (NOTIFY/SSE/WS) | **host** | api `streams.ts` |
| Presence / unread / live cursors | **host** | `presence_events`, live app |
| AI resolution assistant (`comment_resolution_assistant`) | **host** | `context-comments.ts`; package exposes `CommentThreadSummary` + `listThreadSummaries` |
| Comment redaction / PII masking | **N/A (does not exist)** | DROPPED (Decision E); envelope `redactedFields` is pass-through only |
| `TenantContext` / `EventEnvelope` definition | **`@sentropic/contracts`** | imported, not redefined |

Mirrors chat-server/contracts: the only package-visible boundary is the port + event + summary contracts; everything stateful/transport/identity/redaction is host-supplied or absent.

## 6. Pre-test plan (NO UAT, NO docker — standalone vitest, mirrors chat-server/contracts)

Standalone `vitest run tests --environment node` (same invocation as `make test-chat-server`). No DB, no stack. Files under `packages/comments/tests/`:

- `domain-schema.spec.ts` — pure-TS guard parse/serialize of `Comment`/`CommentTarget`/`CommentEvent`/`CommentThreadSummary`; target-kind union coverage incl. `record`/`field` + `sectionKey` (live shapes like `matrix.cell.x.y`); **explicit round-trip test** (live `{contextType, contextId, sectionKey}` → `CommentTarget` → back, asserting no loss — Decision A).
- `in-memory-crud.spec.ts` — `add/get/edit/delete`; `edit` is per-row content-only; `delete` is per-row HARD delete and the root-delete rule (remaining replies persist, thread identity survives — Decision G); `listByTarget` filtering by kind+id+sectionKey+status (mirrors live `listQuerySchema`).
- `threading.spec.ts` — reply minting vs inheriting `threadId`; `listThread` createdAt-ASC-then-id ordering (deterministic tiebreaker, Decision G); reply to unknown thread rejected (live "Thread not found"). **No `parentId` test** (Decision F — flat model).
- `thread-cascade.spec.ts` — `setState` close/reopen and `assign` cascade across ALL thread rows (live thread-level semantics, Decision H); content `edit` does NOT cascade (row-level); state mapping `resolved↔closed`. This file is the package's semantic-contract proof.
- `thread-summary.spec.ts` — `listThreadSummaries` builds `CommentThreadSummary[]` matching the live `tool-service.ts:1235-1283` algorithm (root=earliest, last=latest, count, closed-if-any→`resolved`, first non-null assignee); asserts verbatim field names (Decision D9).
- `tenant-scoping.spec.ts` — operations isolate by `tenant.tenantId`+`tenant.workspaceId`; cross-tenant `get`/`list` returns nothing; cross-tenant mutate is a no-op/throws (§3 threat mitigation, the security-critical test).
- `wire-events.spec.ts` — every mutation emits the correct `CommentEvent` via a collecting `CommentEventSink`; assert the live-action mapping table (§4: created/updated/resolved/reopened/deleted/reassigned); no event on read.

**REMOVED from v1**: `redaction.spec.ts` (DROPPED — no live redaction; Decision E). **ADDED in v2**: `thread-summary.spec.ts` (Decision D9).

Published-package **validate lane** (mirror `validate-chat-server` exactly):
- `make typecheck-comments` → `make test-comments` → `make build-comments` → `make pack-comments` (npm pack --dry-run).
- CI `validate-comments` job gated on `changes: packages/comments/**`; `enforce-package-bump` covers the new package; first publish via `workflow_dispatch bootstrap_publish_target=comments` then attach OIDC trusted publisher on npmjs.com (documented in `BRANCH.md`, per workflow.md "Package Publication"). All under `BR42c-EX1` (Decision D8 / EX1).

Coverage target ≥ 70% (testing.md). All non-AI; nothing in this package is AI/flaky.

## 7. Dependencies & package skeleton (mirror contracts/events/chat-server)

`packages/comments/` files: `package.json`, `tsconfig.json`, `LICENSE` (MIT), `README.md`, `src/index.ts`, `tests/*.spec.ts`.

`package.json` (mirrors the published shape verbatim):
```jsonc
{
  "name": "@sentropic/comments",
  "version": "0.1.0",
  "description": "Collaborative annotation (comments/threads) over messages, canvas, artifacts, fields and records: CommentStore port + in-memory adapter + transport-agnostic wire events + thread summaries.",
  "type": "module", "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/rhanka/sentropic.git", "directory": "packages/comments" },
  "main": "./dist/index.js", "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist", "README.md", "LICENSE"],
  "publishConfig": { "access": "public" },
  "sideEffects": false,
  "scripts": { "build": "tsc -p tsconfig.json", "typecheck": "tsc --noEmit -p tsconfig.json", "test": "vitest run tests" },
  "dependencies": { "@sentropic/contracts": "^0.1.1" },         // for TenantContext + EventEnvelope (zero-runtime-dep sibling)
  "devDependencies": { "@types/node": "^22.10.10", "typescript": "5.4.5" }  // + vitest@4.0.18 installed in make lane
}
```
- **No `zod` dependency** (Decision D7-a confirmed): pure-TS types + hand-written guards keep the package zero-runtime-dep like `contracts`/`events`. The host already validates payloads in zod at the api boundary.
- `tsconfig.json` identical to `contracts`/`chat-server` (ES2022, NodeNext, strict, declaration+maps, `verbatimModuleSyntax`).
- **No `api`/`ui` touch** in BR-42c. Default forbidden: `Makefile`*, `docker-compose*.yml` — *EXCEPTION `BR42c-EX1` (Decision D8): BR-42c adds the `make` targets (`build-/typecheck-/test-/pack-/publish-comments`) and the CI `validate-comments`/bootstrap entries, additive-only, mirroring the verified `chat-server` lane line-for-line (Makefile lines 904-940, 1057-1092, 1171-1174). Rollback = remove the added block.

## 8. Activation note (head-on acknowledgement of the architecture rule)

`rules/architecture.md` states: "Package extraction must be activated by real app consumption … the owning branch must prove at least one app root imports it through workspace wiring." **BR-42c ships the package with NO consuming-app root.** This is an **intentional, plan-sanctioned exception**: BR-42c is the genuinely-new module of the BR-42 family and its activation (Postgres `CommentStore` adapter over the live `comments` table + `api/src/routes/api/comments.ts` adoption + workspace import) is deliberately carved into **BR-42d** (`feat/persistence-comments-observability`), exactly as the persistence/observability split is planned in `plan/42-BRANCH_chore-scale-build-app.md`. BR-42c is verified at the package level (typecheck + unit + build + pack, CI `validate-comments` green); BR-42d performs the real-consumption activation. This exception is stated explicitly so the merge of BR-42c is NOT mistaken for a violation of the activation rule — it is a sequenced two-branch activation (build → activate), not architecture-only scaffolding left inert.

## 9. Decisions ledger (D1–D9 — ALL conductor-resolved, NO user decision pending)

> v2 note: the v1 ledger split "reversible / blocking" with user-facing préco. After the double review (Opus 4.8 + Codex 5.5-xhigh converged), the conductor RESOLVES all of D1–D9. No item is left for the user. The "blocking" framing is retired — every decision below is final for v0.1.0.

- **D1 — Package name `@sentropic/comments`.** RESOLVED: keep (decided in §16.2, 2026-05-31; matches `@sentropic/<dir>` convention). Durable name — conductor confirms as-is (provider-neutral, domain-accurate).
- **D2 — `CommentTargetKind` union = `message|canvas|artifact|field|record`; DROP `usecase`.** RESOLVED: adopt, with `record`+`recordType` (opaque string) as the bucket the live `organization|folder|initiative|matrix|executive_summary` map into, and `field` for `sectionKey` sub-targets. **`usecase` is explicitly OUT** — it is dead in the live surface (`// TODO Lot 10: remove 'usecase'` at `comments.ts:13`; `ensureContextExists` never handles it; UI + AI assistant type without it). The package aligns with `initiative`. Round-trip is lossless (§2 table, Decision A).
- **D3 — State vocabulary `open|resolved` (package) ↔ `open|closed` (live).** RESOLVED: use `resolved` in the package (annotation-domain idiom; event type `resolved`) and document the `resolved↔closed` 1:1 mapping. Reversible mapping, trivially.
- **D4 — Wrap events in `EventEnvelope<CommentEvent>` from `@sentropic/contracts`.** RESOLVED: yes (tenant/ts/seq/redactedFields uniformity, §2/§3) AND keep a bare `CommentEvent` for sink ergonomics. The envelope `redactedFields` is a PASS-THROUGH marker only (Decision E). *(v2 renumber: this was D5 in v1; D4-v1 `parentId` is RETIRED → see Decision F below.)*
- **D5 — Comment redaction: DROP from v0.1.0.** RESOLVED: no live comment redaction exists (grep-confirmed: no `redact*` in `comments.ts`/`context-comments.ts`/`schema.ts`). Remove `redactedFields` from `Comment`; drop `redaction.spec.ts` from §6. Envelope-level `redactedFields` stays a pass-through marker; the package does NO masking. *(v2: this was the v1 "PII redaction marker"; now explicitly dropped from the domain type.)*
- **D6 — Do NOT depend on `@sentropic/events`; own `CommentEvent` types.** RESOLVED: own them (verified: `events` only hosts the chat `StreamEvent` taxonomy, no domain-event registry). Avoids a wrong-direction dependency. Reversible (could re-export later if `events` grows a domain registry).
- **D7 — Domain validation dependency: pure-TS guards (NO `zod`).** RESOLVED: **(a) pure-TS types + hand-written guards for v0.1.0**, keeping the package zero-runtime-dep like `contracts`/`events`. The host already validates in zod at the api boundary; revisit an optional `@sentropic/comments/zod` sub-export only if a real consumer needs shared zod schemas. Sets the package's dependency posture (hard to walk back post-publish) → conductor locks pure-TS.
- **D8 — `BR42c-EX1` scope exception (touch `Makefile` + `.github/workflows/ci.yml`).** RESOLVED & GRANTED: additive `*-comments` make targets + `validate-comments`/bootstrap CI entries, mirroring the verified `chat-server` lane (no edits to existing targets). Rationale: a publishable package is inert without its make+CI lane; impact: additive-only; rollback: delete the added block. Granted as **BR42c-EX1**.
- **D9 — `CommentThreadSummary` is a PACKAGE SURFACE (NEW in v2).** RESOLVED: export `CommentThreadSummary` with VERBATIM live field names (`tool-service.ts:1245-1284` + `context-comments.ts:6-21`): `{ threadId, contextType?|target, sectionKey?, rootMessage, rootMessageAt, lastMessage, lastMessageAt, messageCount, status, assignee? }`. The `CommentStore` port exposes `listThreadSummaries(tenant, query)`. Rationale: the host AI resolution assistant (`context-comments.ts`) must NOT be blocked and must rebuild verbatim without re-deriving names. Tested by `thread-summary.spec.ts` (§6).

**Retired v1 decision:** *D4-v1 (optional `parentId` reply pointer)* — **REJECTED (Decision F)**: the live model is flat (`threadId` only, no `parent_id` column — `schema.ts:645-672`). `parentId` is speculative entropy for v0.1.0; a thread is a flat ordered list. Removed from `Comment`, `NewComment`, and the §6 test plan.

## Review log (Opus 4.8 + Codex 5.5-xhigh — CONVERGED; conductor-resolved)

Double adversarial review converged on the following corrections, all verified against branch code and folded into v2:

- **A — Target round-trip (lossless).** `CommentTargetKind` maps `{contextType, contextId, sectionKey}` with no loss; `sectionKey` kept verbatim as an optional field on every kind; the five live `contextType` values round-trip via `kind:'record'`+`recordType`. Explicit table added (§2) + round-trip test (§6). Verified: `schema.ts:645-672`, `comments.ts`, `ui/.../comments.ts:3`.
- **B — Drop `usecase`.** Verified dead: `// TODO Lot 10: remove 'usecase'` (`comments.ts:13`), `ensureContextExists` never handles it (`comments.ts:30-56`), UI/AI type without it. Package aligns with `initiative` (Decision D2).
- **C — Event union adds `reassigned`.** Verified `tool-service.ts:1381` emits `reassigned`; union = created|updated|resolved(closed)|reopened|deleted|reassigned (1:1 with live wire). REST assignment emits `updated` (`comments.ts:254`); AI reassign emits `reassigned` — both documented (§4).
- **D — `CommentThreadSummary` is a package surface (D9).** Verbatim field names from `tool-service.ts:1245-1284` + `context-comments.ts:6-21`; port exposes `listThreadSummaries`; assistant unblocked.
- **E — Redaction dropped.** Grep-confirmed no live redaction (`comments.ts`/`context-comments.ts`/`schema.ts`). `redactedFields` removed from `Comment`; `redaction.spec.ts` dropped; envelope marker stays pass-through only.
- **F — `parentId` dropped.** Live model flat (no `parent_id`, `schema.ts:645-672`). Rejected as speculative; thread = flat ordered list.
- **G — Delete + ordering + assignee.** Delete = per-row HARD delete (`comments.ts:336` `db.delete`); root-delete rule documented (replies persist; thread identity = surviving rows; COLLAB.md "thread data removed" is host policy). Ordering = `createdAt ASC` + `id` tiebreaker (createdAt non-unique, `schema.ts:661`). Package does NOT validate assignee membership — host gates `assign()` (`ensureWorkspaceMember`).
- **H — Thread-level cascade in the contract.** `setState`/`assign` cascade across all rows sharing `threadId` (verified `comments.ts:278-281, 309-310, 246-250`); content edit is row-level (`comments.ts:252`). In-memory adapter MUST prove this (`thread-cascade.spec.ts`).
- **I — EX1 + activation note.** `BR42c-EX1` granted (additive `*-comments` make + CI entries, mirroring verified chat-server lane Makefile:904-940/1057-1092/1171-1174). Activation deferred to BR-42d acknowledged head-on as a plan-sanctioned exception to `rules/architecture.md` (§8).

Conductor resolution: **ALL decisions D1–D9 are final for v0.1.0. NO user decision remains pending.**

## 10. Next step after review

Consolidate accepted decisions → write `tmp/feat-comments-package/BRANCH.md` from `plan/BRANCH_TEMPLATE.md` (lots: skeleton+domain → port+in-memory adapter+thread summaries → wire events → tests → make/CI lane + publish bootstrap doc), then delete this SPEC_EVOL before tests per MASTER ("consolidate before tests, then delete"). No code in this lot.
