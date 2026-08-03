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
| Connector host and account/workspace exposure | `@sentropic/connector-host@0.0.0` is currently private and exposes injected account and tenant/workspace ports; the latter carries an explicit capability exposure allowlist. The exact `WorkspaceConnectorExposure` name remains a co-specified contract, not a persisted local table. #492 supplies the merged capture → tombstone → revoke-after-commit teardown for connector grants. | A second h2a account-link, credential, exposure, or teardown path. |
| Agents fusion surface | `@sentropic/chat-ui@0.33.0` already exports `AgentsFeedPort` and `AgentsEntry` at `packages/chat-ui/src/state/agentsEntry.ts`, including `kind:'remote'`. PR #502 is the governing cross-host fusion draft. | A parallel “h2a sessions” list, component, ordering model, or feed port. |
| Decision dossiers and Focus | `@sentropic/focus@0.3.0` renders a real Track decision dossier through `packages/focus/src/track/index.ts`; `@sentropic/track@^0.17.0` owns the recorded outcome. The h2a-native `present-decision` method owns agent-to-owner presentation discipline. The measured Focus implementation is currently a read-only `FocusSnapshot`; `FocusLiveSession`/the live write driver is deferred. | A signature widget, chat-based approval protocol, duplicate dossier store, or fabricated attestation. |

## 2. The three parts

### Part 1 — Code-spaces are code workspaces

A code-space—a repository checkout or worktree where agents operate—is enrolled as an existing Sentropic workspace with `type:'code'` and ordinary membership. Its durable cross-boundary identity is a workspace ref (`surface/I1`), never an h2a session or conversation id. The Sentropic-owned enrollment surface MUST create or resolve the existing workspace and membership atomically/idempotently; h2a only submits enrollment and retains the returned workspace ref.

Authorization is workspace membership plus real tenant resolution. Enrollment and every later use MUST call the existing fail-closed resolver path and MUST NOT treat a workspace id as a tenant id. **LIB:** Sentropic exposes the workspace-enrollment surface over its workspace primitive. **INTEGRATION:** h2a submits the code-space enrollment. The exact request/idempotency shape is deliberately left to co-specification with the workspace primitive owner (§6); it cannot introduce a shadow model.

### Part 2 — Remote CLI sessions are visible

This part is BR-39l: reconcile `agent_definitions` with h2a instance/session presence, expose a listing endpoint, and project the result as `AgentsEntry{kind:'remote'}` rows through the ONE `AgentsFeedPort` from #502. Each row uses #502's reserved durable agent reference (`surface/I1`); a session id identifies only the presence view. It is a feed source behind the port, never a parallel list; silent coexistence would violate the surface B3 no-duplicate rule.

Presence is a measured heartbeat with freshness evidence (`surface/I2`), never an inference from enrollment or a last-known row. A remote session is a VIEW (`surface/I3`): the remote CLI host is HOLDER, Sentropic persists no foreign session/transcript state through this surface, and the holder wins every disagreement. Capabilities use the existing connector-host vocabulary and unknown capabilities are dropped (`surface/I4`). The remote host attachment reuses connector-host account/workspace exposure and #492 teardown semantics; it does not mint an h2a-specific exposure plane.

Every remote operation reports `FAIT`, `DÉPOSÉ-EN-ATTENTE`, or `PAS-FAIT` according to `surface/I5`. An unreachable holder can accept a durable deposit only when that acceptance is honest; otherwise the operation refuses as not done. The api/h2a join and endpoint are gated on runtime 0.90.1 and owner signature.

### Part 3 — Decision dossiers under Sentropic; signature through Focus, not chat

h2a submits the existing decision dossier to Sentropic's Focus decision surface and reads its outcome. Sentropic renders the dossier through Focus and records the owner's choice in Track; the signature is the durable decision id plus a real recorded acceptance (`surface/I1` and `surface/I2`), not a chat utterance, UI click without a write, relayer identity, or fabricated `comprehension[]` evidence.

**LIB:** the Sentropic Focus/Track surface renders and records the decision. **INTEGRATION:** h2a submits the dossier and reads the recorded signature. Current placement is split: Focus already renders read-only, while Track already records decisions; the live Focus write driver is a reuse/composition gap, not permission to build a new signature UI.

## 3. Placement and sequencing

Orientation #3 is remote: Sentropic owns durable workspace, exposure, agents-surface, Focus, and Track primitives; h2a remains holder of remote CLI presence and submits integrations into those surfaces. Parts 1 and 3 are the nearer-term designs because their primitives already exist. Part 2 waits for the BR-39l api/h2a join and listing endpoint.

Dependencies remain: #502 for the fused surface; #439 for async tenant authorization and the L6 resolver chain; #492 for revoke-before-cascade teardown; h2a PR #152 for the invariant publisher; Focus/Track for decisions. No implementation starts before both runtime 0.90.1 and owner signature. After both gates open, Codex TERRA may build across the app/chat/agents lanes under separately approved branch scopes.

## 4. LIB/INTEGRATION split and acceptance grid

| Part | LIB — Sentropic owns | INTEGRATION — h2a owns |
|---|---|---|
| 1. Code workspaces | Enrollment over `workspaces` + membership + tenancy resolver | Submit code-space enrollment; retain the durable workspace ref |
| 2. Remote feed | BR-39l listing projection into #502's `AgentsFeedPort` | Supply measured presence/heartbeat as the remote holder |
| 3. Decisions | Focus rendering plus Track-recorded acceptance | Submit dossier; read the recorded outcome/signature |

- **A — Receivability:** named current contracts are `@sentropic/chat-ui@0.33.0`, private `@sentropic/connector-host@0.0.0` over `@sentropic/mcp-platform@^0.1.0`, and `@sentropic/focus@0.3.0` over `@sentropic/track@^0.17.0`. Part 1's exact enrollment contract and Part 2's endpoint are co-specified with their primitive owners; build-time versions are selected only after signature.
- **B — Boundary:** a LIB never enrolls on h2a's behalf; an integration never re-implements the primitive. A source either joins the one port/surface or remains absent—there is no silent coexistence, fallback list, duplicate workspace, or second signature path.
- **C — Order and security:** remote presence and operations obey heartbeat measurement, HOLDER/VIEW authority, workspace/tenant exposure, #492 teardown, and the in-force `surface/I5`. Runtime 0.90.1 plus owner signature gates every lane.

## 5. Non-goals

- No code, lane, build, test, migration, endpoint implementation, or package publication in this branch.
- Not `api/src/routes/api/mcp.ts` or sentropic PR #489: that is Sentropic-as-MCP-server inbound, a different plane.
- No signature in chat, no new signature UI, no h2a workspace, no server-side copy of remote session state, and no parallel agents list.

## 6. Open items

- Assign the BR-39l endpoint owner across api and h2a.
- Track the h2a PR #152 invariant publisher wherever the consuming branch resolves cross-repo documentation.
- Receive the full enumeration of orientations 1–4 from h-cond.
- Co-specify Part 1's exact enrollment shape with the Sentropic workspace primitive owner.
