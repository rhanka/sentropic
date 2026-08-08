# SPEC_EVOL — h2a Into Sentropic Integration (Orientation #3: Remote)

## 0. Status and purpose

This is the design-only D6 specification for orientation #3 (remote) of capitalize-sentropic. It realizes BR-39l, **h2a sessions in the Sentropic UI**, and builds on the one-surface fusion contract in sentropic PR #502, `spec/SPEC_EVOL_AGENTS_SURFACE_FUSION.md`.

No lane or build is authorized. The storm-gate remains h2a runtime 0.90.1, and every build is additionally gated on an owner signature recorded through the decision flow described in Part 3. This document is neither that signature nor permission to merge implementation.

The governing invariants are `surface/I1` through `surface/I5` in h2a's sole publisher, `docs/governance/surface-invariants.md` (h2a PR #152). This specification references that publisher rather than pinning a second copy. In particular, the in-force `surface/I5` is: “un échec ne doit jamais ressembler à un succès ; distinguer FAIT / DÉPOSÉ-EN-ATTENTE / PAS-FAIT ; refuser est le défaut LÀ OÙ accepter honnêtement est impossible.”

## 1. Governing criterion: absence of debt

Every capability in this integration MUST capitalize on an existing Sentropic primitive. A new h2a-side concept that shadows one is architectural debt and is refused.

| Primitive to capitalize | Measured anchor and boundary | Debt that is refused |
|---|---|---|
| Workspaces, membership, and tenancy | `api/src/db/schema.ts` already defines `workspaces` with `type:'code'`, `workspace_memberships`, and the durable `workspace.tenant_id`; `api/src/routes/api/workspaces.ts` creates a workspace plus admin membership. `api/src/services/tenancy/resolve-tenant.ts` is the product resolver; #439 supplies the async `TenantResolver` contract at `packages/mcp-platform/src/authz.ts`. | An h2a workspace registry, an h2a membership model, or `workspaceId := tenantId`. |
| Connector host and account/workspace exposure | `@sentropic/connector-host` is strictly Sentropic-internal: it is private, unpublished, and returns npm 404. Sentropic may reuse its injected account and tenant/workspace ports internally, including the MCP authorization exposure allowlist, but h2a MUST consume a co-specified published or HTTP boundary and MUST NOT depend on connector-host. #492 supplies `capture-before-transaction -> tombstone-and-delete atomically -> revoke-after-commit` for connector grants. | A cross-repo dependency on connector-host, or a second h2a account-link, credential, exposure, or teardown path. |
| Agents fusion surface | `@sentropic/chat-ui@0.33.0` exports `AgentsFeedPort` and the base `AgentsEntry` union at `packages/chat-ui/src/state/agentsEntry.ts`, including `kind:'remote'`; it does **not** yet export the remote `agentRef`, measurement evidence, or HOLDER/VIEW fields required below. PR #502 is the governing design draft for their future additive contract. `@sentropic/h2a@0.91.0` is the published feed producer: `readLocalFeed` returns `H2AFeedResponse`, reads registrations plus presence, refuses partial or unreadable input, and preserves measured freshness. | A parallel “h2a sessions” list or feed port; re-reading raw presence; rebuilding h2a descriptors; or pretending future `AgentsEntry` fields exist in 0.33.0. |
| Decision dossiers and Focus | `@sentropic/focus@0.3.0` renders a real Track decision dossier through `packages/focus/src/track/index.ts`; `@sentropic/track@^0.17.0` owns the recorded outcome. The `@sentropic/track`-shipped, agent-to-HUMAN `present-decision` method owns agent-to-owner presentation discipline; it is distinct from h2a ATTENTION/MANDATAIRE, the inter-agent presenter. The measured Focus implementation is currently a read-only `FocusSnapshot`; `FocusLiveSession`/the live write driver is deferred. | A signature widget, chat-based approval protocol, duplicate dossier store, or fabricated attestation. |

## 2. The three parts

### Part 1 — Code-spaces are code workspaces

A code-space—a repository checkout or worktree where agents operate—is enrolled as an existing Sentropic workspace with `type:'code'` and ordinary membership. The one explicit enrollment binding is `H2AWorkspaceRef.id -> workspaces.id`, following the connector-account-enrollment pattern: the Sentropic-owned enrollment row is unique on `H2AWorkspaceRef.id` and points to exactly one `workspaces.id`. `H2AWorkspaceRef.id` is the sole durable workspace identity that crosses the h2a/Sentropic boundary (`surface/I1`), never an h2a session or conversation id; `workspaces.id` remains Sentropic-internal.

Enrollment lookup is idempotent and keyed only by `H2AWorkspaceRef.id`: requests from h2a carry that id, Sentropic resolves it through the enrollment row to `workspaces.id`, and responses or later events crossing back carry the same `H2AWorkspaceRef.id`. Label or checkout-path matching is FORBIDDEN, as is silently retaining two unbound workspace identities. Authorization is workspace membership plus real tenant resolution. Enrollment and every later use MUST call the existing fail-closed resolver path and MUST NOT treat a workspace id as a tenant id. **LIB:** Sentropic exposes the workspace-enrollment surface and owns the binding row over its workspace primitive. **INTEGRATION:** h2a submits and retains `H2AWorkspaceRef.id`. Wire/schema details remain co-specified with the workspace primitive owner (§6), but they MUST preserve this binding and idempotency rule and cannot introduce a shadow model.

### Part 2 — Remote CLI sessions are visible

This part is BR-39l. `@sentropic/h2a@0.91.0` is h2a's PUBLISHED feed producer: `readLocalFeed -> H2AFeedResponse` already reads registrations plus presence, refuses partial or unreadable sources, and preserves measured freshness. The co-specified Sentropic endpoint MUST consume `H2AFeedResponse` and project it as `AgentsEntry{kind:'remote'}` rows through the ONE `AgentsFeedPort` from #502. It MUST NOT re-read raw presence, reconcile a second descriptor source, or rebuild h2a descriptors; that duplication violates B2. The endpoint remains an own-principal surface under #439: Sentropic authenticates its own caller and resolves the workspace/tenant fail-closed before projecting the feed.

The following remote-row fields are **ADDED-BY-A-FUTURE-SLICE**; none is present in `@sentropic/chat-ui@0.33.0`. They form additive contract `remote-evidence/v1`, produced by the BR-39l Sentropic projection endpoint and consumed by the #502 `AgentsFeedPort`/agents surface. Receivability requires their publication in an explicitly pinned `@sentropic/chat-ui` version later than 0.33.0, with `@sentropic/h2a@0.91.0` as the pinned input producer:

- `agentRef`: durable remote-agent identity derived from the feed descriptor, never the session id; the agents surface consumes it for identity and de-duplication (`surface/I1`).
- `measurement: { measuredAt, source }`: measured feed freshness and its h2a feed source; the agents surface consumes it for freshness/status and MUST NOT synthesize either value (`surface/I2`).
- `authority: { holder, mode:'VIEW' }`: the remote CLI host is HOLDER and the Sentropic row is VIEW; the agents surface consumes it to preserve read-only foreign authority (`surface/I3`).
- `declaredCapabilities`: each `H2AFeedResponse` descriptor's `declaredCapabilities` mapped to display only, constrained to h2a's closed, sanitized `H2A_DECLARED_CAPABILITIES` vocabulary (`surface/I4`).

Self-declared display capabilities are NON-AUTHORITATIVE and MUST NEVER grant, imply, or widen authorization. Connector-host capability exposure remains solely the Sentropic-internal MCP authorization path; there is no mapping from `declaredCapabilities` into that allowlist. Sentropic may reuse connector-host account/workspace exposure internally for the remote host attachment, with #492's `capture-before-transaction -> tombstone-and-delete atomically -> revoke-after-commit`, but h2a consumes only the co-specified published/HTTP boundary and no connector-host dependency.

Every remote operation reports `FAIT`, `DÉPOSÉ-EN-ATTENTE`, or `PAS-FAIT` according to `surface/I5`. An unreachable holder can accept a durable deposit only when that acceptance is honest; otherwise the operation refuses as not done. The api/h2a join and endpoint are gated on runtime 0.90.1 and owner signature.

### Part 3 — Decision dossiers under Sentropic; signature through Focus, not chat

h2a submits the existing decision dossier to Sentropic's Focus decision surface and reads its outcome. Sentropic renders the dossier through Focus and may record an outcome in Track, but that outcome is an owner SIGNATURE only after the Part-3 security gate below is co-specified and satisfied. The signature is the durable decision id plus the owner's MEASURED authenticated act (`surface/I1` and `surface/I2`), not a chat utterance, UI click without a write, relayed append, relayer identity, or fabricated `comprehension[]` evidence.

**LIB:** the Sentropic Focus/Track surface renders and records the decision. **INTEGRATION:** h2a submits the dossier and reads the recorded outcome, treating it as a signature only after verified read-back of an attested owner act. Current placement is split: Focus already renders read-only, while Track already records decisions; the live Focus write driver is a reuse/composition gap, not permission to build a new signature UI.

Before Focus live-write may produce an owner SIGNATURE, the co-specified gate MUST define and enforce: owner/workspace authentication using the own-principal model and #439 tenancy resolution; authorization for the decision and workspace; ATTESTER-vs-RELAYER provenance, with the owner as attester and any transport as relayer only; a pinned Track ingest contract version; an idempotency key and duplicate-result semantics; and read-back confirmation of the persisted attestation. Until every item is specified and satisfied, a Track outcome is **NOT** an owner signature.

## 3. Placement and sequencing

Orientation #3 is remote: Sentropic owns durable workspace, exposure, agents-surface, Focus, and Track primitives; h2a remains holder of remote CLI presence and submits integrations into those surfaces. **Part 3 is the priority-first design and build because it becomes the owner's signature mechanism.** Today #502 is ratified via an artifact only as a STOPGAP; once Part 3 lands, decisions are presented under Sentropic through Focus and their acceptance is recorded in Track. Part 1 remains near-term, while Part 2 waits for the BR-39l api/h2a join and listing endpoint.

Part 3's concrete first build item is the currently deferred Focus live-write driver (`FocusLiveSession` / the live write path) together with its security gate: close the reuse/composition gap so the existing Focus dossier can record a verified owner signature in Track, **not** by creating a new signature UI. Dependencies remain: #502 for the fused surface; #439 for own-principal authentication, async tenant authorization, and the L6 resolver chain; #492 for `capture-before-transaction -> tombstone-and-delete atomically -> revoke-after-commit`; h2a PR #152 for the invariant publisher; Focus/Track for decisions. No implementation starts before both runtime 0.90.1 and owner signature; for this pre-Focus bootstrap only, the ratified artifact is the stopgap signature record. After both gates open, Codex TERRA starts with Part 3, then builds across the approved app/chat/agents lane scopes.

## 4. LIB/INTEGRATION split and acceptance grid

| Part | LIB — Sentropic owns | INTEGRATION — h2a owns |
|---|---|---|
| 1. Code workspaces | Enrollment over `workspaces` + membership + tenancy resolver; own the unique `H2AWorkspaceRef.id -> workspaces.id` binding | Submit code-space enrollment; retain and send only the durable `H2AWorkspaceRef.id` across the boundary |
| 2. Remote feed | Consume `H2AFeedResponse`; add and publish `remote-evidence/v1`; project it into #502's one `AgentsFeedPort` | Produce measured registrations+presence through `@sentropic/h2a@0.91.0` `readLocalFeed`; remain remote HOLDER |
| 3. Decisions | Focus rendering plus security-gated, attested Track recording and read-back | Submit dossier; relay without asserting owner provenance; accept a signature only after confirmed read-back |

- **A — Receivability:** named current contracts are the published feed producer `@sentropic/h2a@0.91.0`, base `@sentropic/chat-ui@0.33.0`, and read-only `@sentropic/focus@0.3.0` over `@sentropic/track@^0.17.0`. Connector-host is private Sentropic implementation and is not receivable cross-repo. Part 1's binding wire/schema, Part 2's endpoint plus a published chat-ui version carrying `remote-evidence/v1`, and Part 3's pinned Track ingest/security contract are co-specified before build-time versions are accepted.
- **B — Boundary:** a LIB never enrolls on h2a's behalf; an integration never re-implements the primitive. A source either joins the one port/surface or remains absent—there is no silent coexistence, fallback list, unbound duplicate workspace identity, raw-feed reconstruction, or second signature path.
- **C — Order and security:** remote presence and operations obey source-preserved heartbeat measurement, HOLDER/VIEW authority, non-authoritative display capabilities, own-principal workspace/tenant authorization, `capture-before-transaction -> tombstone-and-delete atomically -> revoke-after-commit`, and the in-force `surface/I5`. A Part-3 outcome is not a signature without authenticated owner attestation, authorization, provenance, versioned idempotent ingest, and confirmed read-back. Runtime 0.90.1 plus owner signature gates every lane.

## 5. Non-goals

- No code, lane, build, test, migration, endpoint implementation, or package publication in this branch.
- Not `api/src/routes/api/mcp.ts` or sentropic PR #489: that is Sentropic-as-MCP-server inbound, a different plane.
- No signature in chat, no new signature UI, no h2a workspace, no server-side copy of remote session state, and no parallel agents list.

## 6. Open items

- Co-specify Part 1's enrollment-row wire/schema details while preserving the unique `H2AWorkspaceRef.id -> workspaces.id` binding and idempotent lookup rule.
- Assign the BR-39l endpoint owner across api and h2a; pin the first published `@sentropic/chat-ui` version that carries `remote-evidence/v1`.
- **Part-3 gate — authentication:** specify owner/workspace authentication through own-principal and #439 tenancy resolution.
- **Part-3 gate — authorization:** specify who may decide for the workspace and dossier.
- **Part-3 gate — provenance:** specify ATTESTER-vs-RELAYER evidence so only the owner's measured authenticated act is the signature.
- **Part-3 gate — ingest version:** pin the Track ingest contract accepted by the Focus live-write driver.
- **Part-3 gate — idempotency:** specify the write key, replay behavior, and conflict result.
- **Part-3 gate — confirmation:** specify read-back verification of the persisted decision and owner attestation.
- Track the h2a PR #152 invariant publisher wherever the consuming branch resolves cross-repo documentation.
- Receive the full enumeration of orientations 1–4 from h-cond.
