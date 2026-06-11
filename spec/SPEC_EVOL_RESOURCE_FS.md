# SPEC_EVOL_RESOURCE_FS — Resource Plane (filesystem-presented)

Status: deep-study v2, created 2026-06-08, hardened the same day by a double
adversarial review (Codex 5.5 xhigh + Opus 4.8, both GO-WITH-CHANGES).
Companion to `spec/SPEC_EVOL_ARCHITECTURE.md` (PR #268, D1-D11) and
`spec/SPEC_EVOL_DATA_ARCHITECTURE.md` (PR #273, DD1-DD11). Registers as study
**ARCH-21, split into ARCH-21a (integrative, dispatchable) and ARCH-21b
(net-new, gated)**. Brainstorm forks A-D were answered 2026-06-08 (section 7,
B/C/D corrected by the review). Owner decisions RF1-RF11 were taken on
2026-06-08 (section 8): all A except RF8 (C-now/A-later), RF10 (C + three
loci incl. `remote_bash`/tmux), RF11 (A+C-controlled custom-renderer slot).
ARCH-21a is dispatchable; ARCH-21b is gated.

Naming note: the deliverable is a **Resource Plane** — a uniform resource
graph with verbs. The **filesystem** (`ls`/`read`/`edit`/paths/`cat json >
tool`) is OPTIONAL PRESENTATION (chat-ui tree + human prose), NEVER the
contract. The review was unanimous: selling "a filesystem" hides real new
infrastructure and imports POSIX semantics the providers cannot honor.

## 1. Purpose

Sentropic should let a user (and the LLM) reach EVERY resource through one
uniform, navigable namespace — the affordance Claude gives in chat. The plane
unifies, behind one addressing scheme (`ResourceRef`) and one small verb set:

- **capabilities**: tools, skills, agents, workflows, canvas, apps, and each
  registered MCP server's tools AND resources;
- **data**: workspaces → objects → files, hierarchically, titles shown but
  canonical refs underlying;
- **context** (introspection): where the user is navigating now, current
  view/selection, the active knowledge subgraph;
- **knowledge**: the graphify-reconciled index, kept fresh by an event-driven
  indexing stream on every workspace write.

Universal `read`/`edit`; every new MCP registers at the right mount points;
an action is `resource_invoke(ref, args, idempotencyKey)` (presented in chat
prose as `cat '{json}' > /mcp/sentropic/web-search`), async-aware.

Non-purpose (review-hardened): NOT a new storage engine; NOT the only access
path (SQL/REST/graph stay first-class); NOT a POSIX compatibility layer; the
filesystem is presentation, not contract.

## 2. Current Baseline (evidence)

Verified against `origin/main` (post PR #273); corrected by the double review.

- **Capability catalog** (BR-42b): `CatalogSource` is a pluggable provider
  (`static`/`mcp`/`standalone-tool`/`agent-template`/`canvas-template`/
  `workflow-seed`, `api/src/services/catalog/sources/`). Reality check
  (review): it is a SYNC metadata-SNAPSHOT source with optional async
  refresh/health — it has NO `stat/read/write/invoke/watch`, no path tree, no
  per-principal materialization (`api/src/services/catalog/source.ts`). It is
  a provider seed, not yet a mount provider.
- **MCP source**: `McpCatalogSource` connects → `listTools()` → maps tools →
  closes; `callTool()` opens a fresh connection per call
  (`sources/mcp-source.ts`). It maps TOOLS only — NO `resources/list` /
  `resources/read`. The connect-list-close lifecycle is incompatible with
  `resources/subscribe` (watch needs a persistent connection). MCP tool ids
  are RE-DERIVED each refresh with order-dependent collision suffixing
  (`_2`,`_3`) — they are neither provider- nor refresh-stable.
- **ToolRegistry** (chat-core, `packages/chat-core/src/ports.ts`): the
  interface is `resolve` / `has` / `list` — there is NO `invoke`.
  `IdempotencyKey` is a field of `JobRef`, NOT of tool calls. v1's "list +
  invoke + idempotency on calls" was wrong.
- **Authz-scoped listing is NOT yet a proven primitive** (review
  correction): the app path scopes via `SkillsToolRegistry.resolveTools`, but
  `CompositeCatalogRegistry.list/search` are UNSCOPED and `search_catalog`
  searches ALL entries without authz
  (`composite-registry.ts`, `services/skills/catalog.ts`). "Namespace IS an
  authz surface" is a NET-NEW guarantee, not a seeded one.
- **The live tool loop** (`packages/chat-core/src/runtime-tool-dispatch.ts`):
  the model emits streamed structured tool calls; the runtime parses
  `toolCall.args` JSON, calls `executeServerTool`, returns
  `tool_call_result`/`function_call_output`. The model NEVER writes bytes —
  `cat json > tool` is shell prose, not the mechanism.
- **The live async substrate** (`api/src/routes/api/chat.ts`,
  `packages/chat-core/src/runtime.ts`): chat turns + the EXISTING async
  tool-result pause/resume run on the api `queue-manager` (`chat_message`
  jobs) with `previousResponseId` + `resumeFrom` + `acceptLocalToolResult` /
  `AwaitingLocalToolState`. This — NOT the flow `JobQueue`/`/proc/jobs`
  polling — is how a turn awaits a result today.
- **Object access** (ARCH-19, DD1=B): `ObjectResolverPort` + envelope are
  DECISIONS, not code yet; `LiveDocumentStore` is an EMPTY marker interface
  (`_kind` only), not a working canvas store.
- **Event spine** (ARCH-14): no outbox yet; comments emit a BESPOKE
  `NOTIFY comment_events` payload (`pg-notify-comment-event-sink.ts`), not an
  `EventEnvelope` (the `toEventEnvelope` helper exists but is unused on the
  live emit path).
- **Knowledge** (ARCH-06, DD5 rider): `IndexSnapshot` is spec/CLI-federation
  text, NO runtime implementation; graphify external, fusion gated on
  `plan/34` Lot 0.
- **Flow queue**: `job_queue` has atomic claim (`FOR UPDATE SKIP LOCKED`) +
  status + retry metadata + timestamps, but NO lease/heartbeat/DLQ columns;
  the `packages/flow/src/job-queue.ts` header comment advertising those is
  aspirational (the `fix/data-hardening`/BR-44 branch fixes it + adds a
  reaper, and lands first).
- **`/apps` is not code today**: `CatalogEntryKind` = `skill|tool|agent|
  workflow|canvas`; app templates are FUTURE DB control-plane resources
  (ARCH-01). `/apps` cannot be v0-projected.

## 3. Target Concepts

### 3.1 Resolver-first; addressing by canonical ref, path as alias (fork A, hardened)

The CONTRACT is a resource graph addressed by a canonical `ResourceRef`
(equivalently a `res://` URI) with a small verb set. Paths are display
ALIASES, never identity.

```ts
type ResourceRef = {
  provider: string;        // 'catalog' | 'mcp:<server>' | 'objects' | 'context' | 'knowledge' | 'proc'
  scope: ScopeMap;         // binding-defined (DD10): Sentropic = {tenantId, workspaceId}
  type: string;            // 'tool' | 'organization' | 'file' | 'view' | 'job' | ...
  id: string;              // stable provider id (the inode)
  etag?: string;           // version/CAS token for read-then-edit
};
```

Review-mandated rules:

- **id-stability is net-new work**: no stable cross-provider id exists; MCP
  ids aren't even refresh-stable (collision suffix). RF1 must specify id
  derivation + stability per provider before any "rename never breaks refs"
  claim holds.
- **the LLM's path memory is an un-invalidated dentry cache**: the model
  remembers PATH STRINGS, not the hidden ref. So `list`/`read` MUST echo the
  canonical ref + etag alongside the display path, and verbs MUST accept the
  ref form; renamed/colliding title-paths resolve via stale-alias rules
  (RF1). Otherwise rename DOES break the model's remembered path even though
  system refs survive.
- **MCP resources keep the server's opaque `uri` verbatim** as their id — do
  NOT re-path-segment or title-project a server-owned uri.

### 3.2 The namespace (mount tree) — authz-projected

```text
/                                  virtual root (per principal)
├── tools/ skills/ agents/ workflows/ canvas/   catalog kinds (v0)
├── apps/                                        DEFERRED (not code; ARCH-01)
├── mcp/   <server>/tools/<t>   resources/<uri>  mounted MCP surface (tools v0, resources v0 read)
├── workspace/  <ws>/<objectType>/<id>/[files|fields|children]   DEFERRED (ARCH-19 resolver)
├── context/    session  view  nav  selection    introspection, read-only (session subset v0)
├── proc/       jobs/<id>/[status|result|events]  async runs (after BR-44 hardening)
└── knowledge/  <ws>/entities  relations  snapshot   DEFERRED (ARCH-14 outbox + ARCH-06)
```

Rules:

- **mount providers** = a NET-NEW `ResourceProvider` port (`list/stat/read/
  write/invoke/watch` over a subtree), a generalization the current
  `CatalogSource` does NOT yet implement.
- **authz-projected, net-new**: `list`/`stat`/`read`/`invoke` are SEPARATE
  permissions (discover ≠ read ≠ invoke). Deny surfaces as a typed
  deny-as-missing envelope (no existence oracle), with bounded stable
  pagination and audit of hidden-node probes. This is new infrastructure, not
  a property of today's unscoped `CompositeCatalogRegistry`.
- **root `ls` never fans out synchronously** to all providers (FUSE lesson):
  return mounts from cache, populate per-mount lazily.

### 3.3 The verb contract — the universal floor (RF2 consensus)

The LLM-facing universal floor is **`ls` / `read` / `edit` / `grep`**, present
every turn across every provider; `invoke` is the side-effecting seam, reached
via a resolved typed tool (not on the floor). `grep` is the single delegating
SEARCH verb — it IS the §3.5 `query` (one verb, not two).

| Verb (floor) | catalog/mcp-tool | objects (resolver) | mcp-resource | context | knowledge |
|---|---|---|---|---|---|
| `ls` (`list`/`stat`) | capabilities (authz) | child objects | resource list | session/nav | entities/relations |
| `read` | schema + doc (+ref/etag) | envelope+payload (+etag) | resource read | computed snapshot | node + neighborhood |
| `edit` (`write`, CAS) | DENIED (typed) | upsert, CAS on etag | iff server allows | DENIED | DENIED |
| `grep` (delegating search ≡ §3.5 query) | `search_catalog`/`search_skills` (authz) | SQL/FTS on declared fields | server search / `not_searchable` | `history_analyze` (bounded) | graph/text search |
| `invoke` (NOT on floor) | run tool → result/handle | (n/a) | `tools/call` | (n/a) | (graph query = grep) |
| `watch` (21b) | job/tool events | object deltas | `resources/subscribe` | nav changes | (n/a) |

- **`grep` never walks**: it delegates to the provider's native engine and
  returns a typed `not_searchable` (or a bounded cached-metadata result) when
  a provider has no index — it MUST NOT fall back to `ls -R` + client filter.
  This is how the O(n) anti-goal is honored.
- **`invoke` is SEPARATE from `edit`/`write`** (review: never overload write to
  trigger side effects — the Plan 9 ctl-file ugliness lesson + LLM safety).
  The chat-prose `cat json > tool` maps to `invoke`, not `edit`.
- **every read returns an etag**; `edit` echoes it (optimistic CAS). Tools/
  context have no etag (read-only or invoke-only).
- **error envelope** (net-new section): every verb returns a typed,
  LLM-legible error — `not_found` (= deny-as-missing), `denied`,
  `provider_unavailable`, `cas_conflict`, `too_large`, `invalid_args` — never
  a silent no-op.
- **pagination/depth/byte budget**: `list` is paginated with stable page
  tokens + max depth; `read` has a max-byte budget with summary-on-overflow
  (protects the LLM context). Defined in the contract, not left to providers.
- **single-provider writes only** in v0; cross-provider `mv`/`cp`/`rm` are
  OUT OF SCOPE; no transactional write spanning envelope + S3 artifact in v0.

### 3.4 Async invocation rides the live chat resume (fork C, re-grounded)

Async is first-class but built on the EXISTING substrate, not `/proc` polling:

- short tools return the result inline (the current synchronous tool path);
- a long tool's `invoke` returns a handle and the turn SUSPENDS via the
  existing `awaiting_local_tool_results` mechanism, generalized to
  `awaiting_async_tool_results`;
- on completion, the job's result is delivered as the `function_call_output`
  keyed to the original `call_id` + `previousResponseId`, re-enqueuing the
  `chat_message` job through the existing `resumeFrom` path — server-driven,
  event-based, **the model never polls**;
- `/proc/jobs/<id>/{status,result,events}` is the HUMAN/observability
  projection (the Plan 9 ctl/data/status triad), NOT the model's await
  mechanism;
- idempotency must be threaded AT THE INVOKE SEAM (today
  `StandaloneToolHandler` and MCP `callTool` carry neither key nor actor
  chain — net-new), so a retried invoke is not a double side effect;
- the flow `JobQueue` reaper (BR-44) is required only for durable/background
  runs, not for the in-turn async path.

### 3.4bis Skills as the efficiency-resolution layer (RF2 consensus)

The owner's "le skill = la pierre de résolution d'efficience" maps onto the
EXISTING `@sentropic/skills` SKILL.md catalog — not a new concept. Both
reviewers converged: a skill is MODEL-SELECTED (the runtime dispatches by the
tool name the model emits — `runtime-tool-dispatch.ts` — so there is no router
that silently rewrites a base verb into a typed tool). The 3-tier flow:

1. **Floor + discovery** always present: `ls/read/edit/grep` + `search_skills`
   (auto-injected) + `search_catalog`.
2. **Skill resolution (model-selected)**: the model `grep`s/`search_skills`,
   reads the chosen SKILL.md; selecting it resolves its TYPED tools into the
   next turn via the existing `ToolRegistry.resolve(authz, toolNames)` /
   `resolveTools(authz, {skillName})`, and injects the SKILL.md body (the
   access instructions) as a system overlay. Evidence the pattern already
   exists: the `organizations` skill bundles `organizations_list` /
   `organization_get` / `organization_update` (typed ls/read/edit per domain);
   `workspace` bundles `initiative_search` (server-side filtered, never a
   walk).
3. **Typed tool (efficiency)**: the model calls the recommended typed tool;
   its JSON Schema is preserved via the existing
   `resolve → inputSchema → OpenAI function parameters` path
   (`services/skills/catalog.ts`). Generic `invoke(ref, args)` is the
   last-resort fallback ONLY (capabilities the model could not resolve to a
   typed schema) — never the primary path (that is the RF2-A degradation).

New mechanism (the concrete "efficiency stone", from the Codex consensus):
SKILL.md gains structured `accessMethods` metadata alongside the prose body —
`accessMethods: [{ resourcePattern, preferredTool, fallbackVerb,
queryableFields }]` — so a skill declares, machine-readably, the efficient
access path for a resource pattern. The dispatcher resolves only the selected
skill's allowed tools + enforces authz; it never invisibly substitutes a typed
tool for a base verb (auditability + schema safety).

### 3.4ter Bash-like terminal over the plane + chat interaction visualization (RF10/RF11 — owner addition 2026-06-08, under mini-study)

Owner addition: beyond `ls/read/edit/grep`, a **bash-like tool** that drives
the virtual filesystem in standard-terminal fashion — usable both inside the
JS sandbox AND from chat; AND, in chat, beyond canvas editing, for certain
tools (e.g. a real bash), **interaction-visualization** affordances: callbacks
on files accessed in read/write so the user can visualize/edit them via canvas,
an expandable terminal pane, etc. A dedicated double mini-study (Codex 5.5
xhigh + Opus 4.8, 2026-06-08) converged:

- **RF10 — TWO named, capability-scoped tools, not one** (forced by runtime
  reality: the BR-19 sandbox is `isolated-vm`, a pure-JS isolate with NO
  `child_process` — a real shell cannot run inside it):
  - **`resource_terminal`** — a VIRTUAL shell over the Resource Plane: a
    BOUNDED command interpreter (not POSIX), `ls/cat/grep/edit` → plane verbs,
    explicit `invoke` syntax for resolved refs; `mv/cp/rm/chmod/symlinks/
    subshells/process-pipes/shell-expansion/recursive-client-grep` all return
    typed `not_supported` (§5#11 guard). Primarily a HUMAN power affordance (a
    third presentation alongside the chat-ui tree and the LLM tool family,
    §5#12) + an optional V8 skill-authoring host surface. **NOT a default LLM
    tool**: a stringly terminal for the model would UNDERCUT RF2 (it discards
    JSON Schema, the per-verb authz projection, the loop-guard signature, and
    idempotency threading) — the LLM keeps the typed `ls/read/edit/grep` floor,
    which IS the typed terminal vocabulary.
  - **`local_bash`** — a REAL shell, only in a real code/dev workspace
    (ARCH-05/cowork, gated). The vscode-ext local-tool lane already has the
    exact shape (`bash -lc` in workspace cwd, timeout/buffer/permission policy,
    `ui/vscode-ext/local-tools.ts`); it is an explicit capability-scoped
    code-execution tool (consent-gated like cowork eyes/hands), stringly is
    legitimate there because the FS is real, not a projection.
  - **`remote_bash` (owner addition, 2026-06-08)** — a THIRD locus: when
    remote (ARCH-05) provisions REAL k8s sessions, a terminal attached to a
    live session — envisaged as a **tmux attach to a real session** (with or
    without a CLI). This is a persistent, attachable, possibly long-lived
    shell over a real remote FS, distinct from the one-shot `local_bash`:
    it needs session lifecycle (create/attach/detach/kill), a persistent
    duplex stream (the per-message StreamBuffer is per-turn; an attached tmux
    needs a session-scoped stream channel — net-new, ARCH-05/ARCH-17-gated),
    and the remote FS surfaced as the `remote-fs` ResourceProvider for RF11
    traces. Gated on ARCH-05 remote k8s sessions; informs the deployment/edge
    plane (ARCH-17).
  - all three stream stdout via the per-message `StreamBuffer`
    (streamId = assistantMessageId) for one-shot runs; `remote_bash`'s
    attached-session duplex stream is a session-scoped channel (net-new);
    long/external runs use the existing pause/resume/tool-results path
    (`acceptLocalToolResult`/`resumeFrom`).
- **RF11 — ONE normalized `ToolInteractionTrace`**, a generalization of the
  invoke/local-tool result (NOT a side-channel), emitted by opt-in tools and
  riding `tool_call_result` + stream events:
  ```ts
  { toolCallId, toolName, executionMode: 'resource_terminal'|'local_bash'|'tool',
    terminal?: { streamId, exitCode? },
    touches: [{ access:'read'|'write'|'create'|'delete', resourceRef?, realPath?,
                ranges?, beforeEtag?, afterEtag?, mimeType? }],
    provenance: { actor, workspaceId?, capabilityId?, idempotencyKey? } }
  ```
  - the **file-access callback** = the invoke seam emitting touched refs: the
    virtual shell / any plane invoke emits `ResourceRef`s; a REAL bash emits
    real `{realPath, workspaceRoot}` and does NOT claim Resource Plane identity
    until ARCH-05/ARCH-19 expose a `remote-fs` provider mapping paths→refs.
  - **chat-ui rendering (21a)**: file chips (read → canvas VIEW via the
    existing `read` verb + download fallback; over the existing
    `packages/chat-ui/src/documents` module) + an expandable terminal pane
    (over the `StreamBuffer`). Rich canvas **diff** can ship 21a as a two-etag
    read; **edit-back from canvas** is ARCH-16-gated (`LiveDocumentStore` is an
    empty marker today). `watch` on a touched file is ARCH-14-gated.
  - **per-tool opt-in**: a catalog/skill capability descriptor
    `interactionTrace: { terminal?, touchedResources?, canvasActions?:
    ['view','diff'] }`, aligned with the RF2 `accessMethods` metadata — only
    flagged tools render the rich UI.
  - **controlled per-tool custom renderer (owner decision RF11=A+C, 2026-06-08)**:
    the normalized trace is the floor, AND a tool MAY declare its OWN renderer
    component WITHIN the unified contract — `interactionTrace.customRenderer`
    points to a registered, sandboxed render component fed the SAME typed
    trace; it does NOT bypass the contract (chips/terminal/provenance/authz
    still hold). This is the controlled middle ground: bespoke rendering is
    allowed but framed (a render slot in the unified contract), never a
    free-form per-tool UI. The renderer registry + sandboxing is a chat-ui
    deliverable; v0 ships the default renderer, custom renderers are an
    additive opt-in.

Both build only on decided/existing pieces (sandbox BR-19, stream buffer,
documents module, the local-tool protocol, `resource_invoke`); real bash and
the `remote-fs` mapping are ARCH-05-gated, edit-back is ARCH-16-gated.

### 3.5 The plane is a projection, not the only way

Same anti-goal as v1, reinforced: `grep` (the floor search verb, ≡ this
section's `query`) delegates to the native engine (registry SQL over declared
queryable fields, REST routes + openapi, knowledge graph query) — never a
recursive `ls`. `ls -R`/glob is NOT the retrieval API; glob delegates to
`grep`. (Search over `/workspace`
depends on ARCH-19 queryable fields → ARCH-21b.)

### 3.6 Context as introspection (fork D, corrected to session-only for v0)

`/context` and `/proc` are READ-ONLY, computed-on-read. v0 ships only the
slices backed by EXISTING state:

- `/context/session` — from chat session fields (`primaryContextType`,
  `contextId`, `chatContexts`);
- `/context/nav` `/context/view` `/context/selection` — need a UI state
  adapter (small net-new) feeding live navigation; v0 may ship a minimal
  `nav` and defer `view`/`selection`;
- `/context/knowledge` — DEFERRED to ARCH-21b (depends on the index).

### 3.7 Continuous knowledge indexing (fork B — DEFERRED to ARCH-21b)

The event-driven incremental pipeline (write → outbox → indexer → snapshot)
is the right model BUT cannot ship in v0: there is no outbox (ARCH-14), no
`IndexSnapshot` runtime (ARCH-06), and graphify fusion is gated (`plan/34`).
Freshness corrections for when it does land:

- the outbox guarantees PER-AGGREGATE ordering, not a global sequence — a
  single workspace `indexed_through_seq` is ill-posed and would lie under
  concurrent writes. Use PER-PARTITION/per-source watermarks, or expose only
  `last_indexed_at` + `lag` and don't promise a precise seq;
- coalesce-per-aggregate back-pressure (indexing is idempotent-by-latest-
  state); DLQ + reindex for failed incremental merges; stale reasons.

## 4. ARCH-21 split + net-new infrastructure (review correction to "mostly integrative")

v1 undersold the scope. Honest split:

**ARCH-21a — integrative, dispatchable now** (over existing abstractions):
- `ResourceProvider` PORT + verb dispatcher + canonical `ResourceRef`/etag
  (the port abstraction is the net-new Resource Plane core);
- catalog projection mounts `/tools /skills /agents /workflows /canvas` — the
  Resource Plane CONSUMES the catalog (it does NOT own the catalog sources).
  The `CatalogSource → ResourceProvider` ADAPTER (so the catalog mounts under
  the plane) is a CATALOG-lineage deliverable (BR-42j, WP-CATALOG), not BR-70;
- `/mcp/<server>/tools` mount (tools already mapped by `McpCatalogSource`,
  BR-42b). MCP `/mcp/<server>/resources` requires extending `McpCatalogSource`
  to map `resources/list`+`read` (URI-preserving) — this MAPPING is a
  CATALOG-lineage deliverable (BR-42i, the BR-19b/BR-42b continuation), NOT a
  BR-70 deliverable; the Resource Plane only PROJECTS what the catalog source
  exposes. BR-70 depends on BR-42i (resources) + BR-42j (adapter);
- `resource_invoke` returning inline result OR a handle, async via the
  existing chat resume; `/proc/jobs/<id>/{status,result}` after BR-44;
- `/context/session` (+ minimal `/context/nav`);
- authz-projected namespace (separate discover/read/invoke scopes, deny-as-
  missing, pagination) — net-new but bounded to the catalog's cheap case;
- the LLM tool family (discovery `ls`/`read` → resolve to TYPED tool via the
  existing `ToolRegistry.resolve`, RF-grain decision) + chat-ui tree.

**ARCH-21b — net-new, gated**:
- `/workspace` data + `query` (gated on ARCH-19 resolver + queryable fields);
- `/knowledge` + `/context/knowledge` + freshness (gated on ARCH-14 outbox +
  ARCH-06 indexer + graphify fusion);
- generic resource `watch` beyond the per-message `StreamBuffer` (no generic
  streaming exists today; gated on ARCH-14);
- `/apps` (gated on ARCH-01 app control-plane).

Net-new infra to acknowledge in BOTH (not "just a projection"): the stable
ref/inode layer, the `ResourceProvider` dispatcher, the authz-projected
per-principal namespace, the UI tree, the LLM tool family, the async bridge,
the MCP resources mapping, and `watch`.

Amendments to existing studies: ARCH-01 (CatalogSource → ResourceProvider;
kinds → mounts; `search_catalog` becomes the discovery escape-hatch and gains
authz scoping), ARCH-06 (incremental index trigger + freshness + MCP
resources), ARCH-07 (async invoke = a run; in-turn path uses chat resume, not
the flow queue), ARCH-14 (outbox producers for object/file writes; watch reads
durable outbox not raw NOTIFY), ARCH-19 (resolver = `/workspace` backend),
ARCH-02 (namespace projection = capability projection; guest/public
principals), ARCH-13 (quota/cost for read/query/watch/external-MCP calls),
ARCH-15 (residency/retention for mounted external resources).

## 5. Risks and anti-goals

1. **FS-as-only-way / `ls -R` as retrieval** — delegate to `query` (§3.5).
2. **Path-as-identity** — id/ref-canonical, paths are aliases; echo ref+etag.
3. **Existence oracle** — separate discover/read/invoke scopes, deny-as-
   missing, bounded pagination, probe audit.
4. **Sync indexing coupling** — outbox-async only; and DEFERRED to 21b.
5. **Double-invoke** — `IdempotencyKey` threaded at the invoke seam (net-new).
6. **Write to projections** — `/context`,`/knowledge` read-only.
7. **MCP resource/content trust** — size/MIME/class/secret gating before
   content enters the LLM context.
8. **Prompt injection via read AND list** — read CONTENT is data-tagged with
   provenance, never instructions; AND tool/resource DESCRIPTIONS are
   model-visible at `list` time (before any read) — a description-poisoning
   vector (RF6 must cover both).
9. **Context blowup** — pagination, depth limits, byte budget, summaries.
10. **Provider latency** — per-provider async refresh + cached listings; root
    `ls` never fans out synchronously.
11. **FS metaphor leak** — POSIX semantics the plane does NOT honor must be
    enumerated and each marked supported / denied-with-typed-error / out-of-
    scope: no cwd/relative paths (absolute refs only), no symlinks (use DD7
    typed references for an object visible under two mounts), glob → `query`,
    `mv`/`rm`/`cp` out of scope v0, no `chmod` (authz is policy-driven), no
    atomic cross-provider rename.
12. **Two consumers conflated** — the chat-ui tree (human, lazy, latency-
    tolerant) and the LLM tool family (token-bounded, schema-driven) have
    divergent needs; design them as two presentations of one plane, not one
    surface.

## 6. What proves it (ARCH-21a v0)

Feasible NOW, no unbuilt dependency (review-validated):

- `/tools /skills /agents /workflows /canvas` `list`+`read` from the catalog,
  authz-scoped (the scoping is the net-new proof, not assumed).
- `/mcp/<server>/tools` mount (catalog already maps MCP tools). The MCP
  `/mcp/<server>/resources` mapping is a CATALOG deliverable (BR-42i,
  WP-CATALOG) — the v0 proof projects whatever the catalog exposes; if BR-42i
  has not landed, v0 proves the tools mount and the resources mount follows
  the catalog source.
- `resource_invoke(ref,args,idempotencyKey)` returning inline result OR a
  `/proc/jobs/<id>` handle; long invoke suspends + resumes the turn via the
  existing `acceptLocalToolResult`/`resumeFrom` path — the model never polls.
- `/proc/jobs/<id>/{status,result}` after BR-44 queue hardening.
- `/context/session` from chat session fields; minimal `/context/nav`.
- chat-ui tree affordance; LLM uses discovery tools then a resolved TYPED tool.

DEFERRED to 21b: `/workspace`, `/knowledge`, `/context/knowledge`, generic
`watch`, `/apps`, `query` over data.

## 7. Brainstorm forks (A-D) — DECIDED 2026-06-08 (B/C/D corrected by review)

| ID | Fork | Decision (corrected) |
|---|---|---|
| A | Interface contract | Resolver verbs on a ref-canonical graph + FS as PRESENTATION (non-contractual); id-stability + ref-echo are net-new (RF1) |
| B | "graphify on every put" | Async via outbox + incremental indexer; **DEFERRED to ARCH-21b** (no outbox/index/graphify-fusion yet); per-partition watermarks, not a global seq |
| C | Async action model | First-class in v0 but via the EXISTING chat resume (`acceptLocalToolResult`/`resumeFrom`), NOT `/proc` polling and NOT the flow JobQueue; `/proc` = observability only |
| D | v0 mount scope | Capabilities + MCP tools&resources + `resource_invoke` + `/proc/jobs` + `/context/session` (ARCH-21a). `/knowledge` + `/workspace` + `watch` + `/apps` → 21b (fork D as written was internally inconsistent — `/knowledge` needs the unbuilt outbox) |

## 8. Owner decisions (RF1-RF11) — DECIDED 2026-06-08

Reconciled across both reviewers (their leans agreed on every item), answered
by the owner 2026-06-08: RF1=A, RF2=A, RF3=A, RF4=A, RF5=A, RF6=A, RF7=A,
RF8=C-now/A-later, RF9=A, RF10=C (+`remote_bash`/tmux third locus),
RF11=A+C-controlled (custom-renderer slot within the unified contract).

| ID | Decision | Options | Recommendation |
|---|---|---|---|
| RF1 | Addressing + id stability (published surface) | A canonical `ResourceRef`/`res://` URI + path aliases, ref+etag echoed in every list/read, per-provider id-derivation+stability rules, stale-alias resolution; B path-string API; C MCP-uri-only | A — adopt MCP opaque uri verbatim for mcp resources; specify catalog/MCP id stability (today name-derived, MCP suffix unstable) |
| RF2 | LLM tool-family grain (the core UX decision) — REFINED by owner + RF2 consensus | A universal floor `ls/read/edit/grep` (grep = delegating search ≡ query) + model-selected SKILL.md efficiency-resolution (skills gain `accessMethods` metadata) → resolved TYPED tool, `invoke(ref,args)` fallback only; B dispatcher auto-routes base verbs (opaque, hides typed schemas); C eager-typed (all visible tools every turn, token bloat); D read-only floor (`ls/read/grep`, no universal `edit`) | A — both reviewers converged independently; A is the owner's "skill = efficiency-resolution stone" made literal on the EXISTING `resolve(toolNames)`/`resolveTools({skillName})`/`search_skills` machinery; B hides schemas, C bloats tokens, D weakens the universal plane. Sub-tunings (injection timing, grep schema, accessMethods shape) are 21a impl details |
| RF3 | Verb set; invoke distinct from write | A list/stat/read/write/**invoke**/watch (write never triggers side effects); B minimal (invoke-as-write); C POSIX-rich | A |
| RF4 | Async await mechanism | A server-driven event resume reusing `acceptLocalToolResult`/`resumeFrom` (`/proc` = observability); B LLM polls `/proc/jobs/<id>/result`; C sync-only v0 | A |
| RF5 | Authz / discoverability | A separate discover/read/invoke scopes + deny-as-missing envelope + bounded pagination + probe audit; B namespace-listing = authz (existence oracle risk); C raw catalog | A |
| RF6 | Injection boundary (read AND list) | A all read content data-tagged with provenance + content-type, never instructions, AND list-time tool/resource DESCRIPTIONS treated as untrusted; B trust server content; C per-provider trust flag | A |
| RF7 | MCP resources mount + lifecycle | A URI-preserving allowlisted resources + templates + MIME/size/class/secret policy; persistent connection only if `watch`/subscribe wanted (current source is connect-list-close); B tools-only v0, resources next; C full passthrough | A (B acceptable for a narrow v0). OWNERSHIP CORRECTION (owner, 2026-06-11): the MCP `resources/list`+`read` MAPPING belongs to the CATALOG lineage (continuation of BR-19b/BR-42b `McpCatalogSource`) = **BR-42i (WP-CATALOG)**, NOT BR-70. The Resource Plane only PROJECTS it. The `CatalogSource→ResourceProvider` adapter = **BR-42j (WP-CATALOG)**. BR-70 depends on both |
| RF8 | Watch / freshness | A outbox-backed (after ARCH-14), per-partition watermarks + `last_indexed_at`/`lag`, no global seq; B raw NOTIFY; C no `watch` v0 | C now (ARCH-21a), A later (ARCH-21b) |
| RF9 | Edit/versioning + package home | edit: A ETag/CAS + error envelope (B provider-specific / C no-writes-v0 for non-data); home: A app-local proof then extract / B new `@sentropic/resource-fs` now / C chat-core subpath | edit A (C for non-data v0); home A then extract, gated on ARCH-12/D11 |

| RF10 | Bash-like terminal over the plane (mini-study converged + owner) | DECIDED C + THREE loci: `resource_terminal` (bounded virtual shell, HUMAN affordance + V8 authoring, NOT a default LLM tool — protects RF2); `local_bash` (real one-shot shell, ARCH-05/cowork-gated, existing vscode-ext shape); **`remote_bash`** (tmux-attached real k8s session, persistent/attachable, session-scoped duplex stream, ARCH-05/ARCH-17-gated — owner addition) | DECIDED C; remote bash = real k8s sessions with tmux attach when remote lands; stringly LLM terminal rejected (undercuts RF2); isolate has no child_process |
| RF11 | Chat tool-interaction visualization (mini-study converged + owner) | DECIDED A+C-controlled: ONE normalized `ToolInteractionTrace` (touched refs/paths + ranges + etags, terminal stream, exit, provenance) as the floor; chat-ui = file chips (view via `read` + download) + expandable terminal pane (`StreamBuffer`) + per-tool `interactionTrace` opt-in; PLUS an optional per-tool `customRenderer` slot fed the SAME typed trace WITHIN the unified contract (does not bypass chips/terminal/authz) | DECIDED A+C-controlled; view/diff ship 21a over `read`+documents+StreamBuffer; edit-back ARCH-16-gated; real-bash path→ref ARCH-05-gated; custom-renderer registry+sandbox = chat-ui deliverable, default ships v0 |

Implicit decided (from forks, recorded so the owner can override): ARCH-21
SPLIT into 21a/21b; v0 scope = ARCH-21a §6; POSIX surface enumeration = §5#11;
RF2 = option A (3-tier floor + skill-resolution + typed tool), grep ≡ query
(one verb).

## 9. Review log

- 2026-06-08: v1 drafted after a brainstorm (forks A-D), grounded in the
  catalog/MCP/chat-core/resolver evidence.
- 2026-06-08: Round 1 — double adversarial review (Codex 5.5 xhigh + Opus
  4.8, both GO-WITH-CHANGES). Falsifications fixed: `ToolRegistry` has
  resolve/has/list, NO invoke (IdempotencyKey is on JobRef); authz-scoped
  listing is NOT a seeded primitive (`CompositeCatalogRegistry`/
  `search_catalog` are unscoped); `CatalogSource` is a snapshot source, not a
  mount provider; `/apps` is not code; `LiveDocumentStore` is an empty
  marker; comments emit bespoke NOTIFY not `EventEnvelope`; flow lease/DLQ is
  an aspirational comment; `IndexSnapshot` is spec-only; MCP ids are not
  refresh-stable. Concepts hardened: `cat json > tool` is shell prose →
  `resource_invoke` + hybrid discovery-then-typed-tool (RF2); async re-anchored
  on the live `chat_message` resume, not `/proc` polling (RF4); invoke kept
  distinct from write (RF3); id/ref-canonical with ref+etag echoed for the
  LLM's path memory (RF1); namespace-as-authz is net-new with separate
  discover/read/invoke scopes (RF5); POSIX surface enumerated (§5#11);
  description-poisoning added to the injection boundary (RF6); MCP
  resources/watch connection-lifecycle (RF7); freshness per-partition not
  global, and DEFERRED (RF8); ARCH-21 SPLIT into 21a (integrative, now) /
  21b (net-new, gated); fork D corrected (v0 = §6, `/knowledge` → 21b); error
  envelope + pagination/byte-budget added to the verb contract. RF packet
  rewritten RF1-RF9.
- 2026-06-08: Owner answered RF1=A, RF4=A, RF5=A; refined RF2 (add `grep` to
  the floor, "skill = efficiency-resolution stone", typed tool for
  efficiency) and asked for a dedicated RF2 consensus. RF2 consensus (Codex
  5.5 xhigh + Opus 4.8, convergent): universal floor `ls/read/edit/grep`
  (grep ≡ query, delegating, never a walk) + MODEL-SELECTED SKILL.md
  resolution (skills gain structured `accessMethods`) → resolved TYPED tool;
  `invoke` off the floor, distinct from `edit`; the 3 tiers already exist in
  the catalog/skills code (foundation skill `organizations` = typed
  ls/read/edit; `workspace` = `initiative_search`). RF2 rewritten to option A.
  Owner ADDED a bash-like terminal over the plane (RF10) + chat
  tool-interaction visualization (RF11) — §3.4ter.
- 2026-06-08: RF10/RF11 double mini-study (Codex 5.5 xhigh + Opus 4.8,
  convergent). Findings: the BR-19 sandbox is `isolated-vm` (NO child_process)
  → real bash cannot run in it; a stringly LLM terminal would undercut RF2.
  RF10 = TWO tools (RF10=C): `resource_terminal` (bounded virtual shell,
  human/V8-authoring affordance, NOT a default LLM tool) + `local_bash` (real
  shell, ARCH-05/cowork-gated; the vscode-ext `bash -lc` is the existing
  shape). RF11 = ONE normalized `ToolInteractionTrace` (RF11=A); file-access
  callback = invoke seam emitting touched refs (virtual) / real paths (bash,
  no plane identity until ARCH-05/19 `remote-fs`); chat-ui view/diff ship 21a
  over `read`+documents+StreamBuffer, edit-back ARCH-16-gated. §3.4ter +
  RF10/RF11 rows updated. Pending: owner sign-off on RF2(confirm)/RF3/RF6/RF7/
  RF8/RF9 + RF10/RF11.
