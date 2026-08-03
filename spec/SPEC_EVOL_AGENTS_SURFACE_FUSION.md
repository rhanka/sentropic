# SPEC_EVOL — Agents-Surface Cross-Host Fusion Contract (D6 slice a)

## 0. Status & framing

- **This is D6 slice (a), design-only.** It *poses* the contract. It launches no lane and specifies no build. The storm-gate (h2a runtime 0.90.1) holds and **no build precedes owner signature** (D6 process).
- **Flow this document is entering:** architect poses (this file) → h2a-architect evaluation against the 6′ surface contract → conductor consolidation → **owner signature**. Only then, gated on 0.90.1, does any build begin.
- **Why this is a repo spec and not an h2a message:** when this slice was drafted, the 6′ surface invariants, the D6 plan, and orientations 1–4 lived only as h2a review messages. This §0 capture and h2a PR #152's durable publisher were simultaneous repairs of that same fragility. This document now cites that sole publisher rather than pinning another copy.
- **Relation to existing specs:** `spec/SPEC_EVOL_AGENTS_SURFACE.md` defines the **chat-side** surface (tabs `agents | chats | comments`; absorbing sessions, jobs, remote, CLI — items R1–R15). This document is the **cross-host** layer *above* it: the contract by which **plugins** and **cowork** agents become entries on the *same* surface, under surface/I1–surface/I5. It does not restate R1–R15; it constrains how any host's agents join the one surface.
- **Capitalization split (D6):** sentropic ships the **LIB** (the surface component + the feed *port*); each host wires the **INTEGRATION** (the feed *source* that enrolls its agents). This document specifies the LIB contract and the port; it does not specify any host's integration.

## 1. Objective

One agents surface, not two (nor five). Today cowork agents, plugins, chat sessions, queue jobs, and CLI transcripts are — or would be — surfaced through separate lists. This contract makes them **entries on a single `AgentsFeedPort`**, rendered by a single `AgentsList`, each carrying enough contract to satisfy surface/I1–surface/I5 regardless of which host holds it.

Non-goal here: the *data* for remote/perennial/plugin/cowork agents. That is the BR-39l feed gap (§6), gated. This slice delivers the **contract and the port**, buildable and reviewable now; the feed sources land after the gate.

## 2. The 6′ surface contract (surface/I1–surface/I5) — publisher reference

The sole publisher is h2a's `docs/governance/surface-invariants.md` (PR #152). The bullets below are a short, non-authoritative gloss for this slice; consumers must use the publisher for the governing text.

- **surface/I1 — durable identity crosses the boundary, never a conversation id.** Reserve the slot for the reclaimed identity; do not weld an ephemeral id while the resume path is repaired.
- **surface/I2 — the surface states, operation by operation, what is measured and what is asserted.**
- **surface/I3 — every object is marked HOLDER or VIEW.** A renderer never persists a VIEW, and the holder wins on disagreement.
- **surface/I4 — capabilities use the existing cross-host vocabulary.** No host-specific second grammar is opened.
- **surface/I5 —** «un échec ne doit jamais ressembler à un succès ; l'appelant doit pouvoir distinguer FAIT / DÉPOSÉ-EN-ATTENTE / PAS-FAIT ; refuser est le défaut LÀ OÙ accepter honnêtement est impossible.»

## 3. The fusion model

**One port.** The surface consumes exactly one `AgentsFeedPort` (already defined at `packages/chat-ui/src/state/agentsEntry.ts`): `list(scope) → readonly AgentsEntry[]` with an optional `subscribe`. Hosts do not each get a bespoke list; they each get to be a **feed source** behind the one port.

**Entries are kinds, not surfaces.** `AgentsEntryKind = 'agent' | 'session' | 'remote' | 'job' | 'run'`. A plugin agent and a cowork agent are `AgentsEntry` rows (`kind:'agent'` or `kind:'remote'`) with a `connection` marker and a `hostKind` — **not** a second component. The fusion is: cowork and plugins each contribute rows to the same port; `AgentsList` renders the union.

**Provenance is explicit.** Every entry declares its `hostKind` (which host holds it) and its `connection` (reachability/link state). These two fields are the carriers for surface/I2, surface/I3, and surface/I5 at render time.

Fresh-main field state measured in `packages/chat-ui/src/state/agentsEntry.ts` for this slice:

| Field / marker | Fresh-main state | Role in this contract |
|---|---|---|
| `hostKind` | **EXISTS** | Identifies the originating host. |
| `connection` | **EXISTS** | Carries reachability/link state. |
| `agentRef` | **ADDED-BY-THIS-SLICE** | Reserves the durable agent identity required by surface/I1. |
| HOLDER / VIEW marker | **ADDED-BY-THIS-SLICE** | Declares authority as required by surface/I3. |
| `measuredAt` | **ADDED-BY-THIS-SLICE** | Distinguishes measured presence from an asserted/last-known status for surface/I2. |

## 4. surface/I1 / surface/I3 / surface/I4 compliance (owner-named for slice a)

### surface/I1 — durable identity, reserved not welded
- `AgentsEntry` **reserves** a durable-identity slot (`agentRef`) distinct from any per-conversation/session id. The feed keys an agent on `agentRef`, never on `providerSessionId` or a conversation id.
- The contract records the known defect it must not re-introduce: the `reclaimOrMint` resume path matches on `host+providerSessionId` (changes every conversation), so reprise never fires and a fresh identity is minted silently. **This slice reserves the slot and TARGETS the resumed identity; it does not weld a conversation id in the meantime, and it does not attempt to repair the resume path** (that repair is out of scope, feed-time).
- **Testable after this slice adds `agentRef`:** a fixture feed with two conversations of the *same* durable agent must collapse to **one** `AgentsList` row (same `agentRef`), never two. This assertion is not testable against the fresh-main type today because that field does not yet exist.

### surface/I3 — holder vs view, renderer never persists
- Every `AgentsEntry` is marked **HOLDER** or **VIEW**. A cowork/plugin agent rendered in sentropic is a **VIEW** (the holder is the cowork/plugin host). A sentropic-owned chat session is a **HOLDER**.
- `AgentsList` (and any renderer) **persists nothing** about a VIEW entry — no local write-back of a foreign agent's state.
- **On disagreement the holder wins:** if the sentropic view and the holder differ, the surface reflects the holder or marks the entry stale (surface/I5), never overrides the holder from the view.
- **Testable after this slice adds the HOLDER/VIEW marker:** a renderer given a VIEW entry performs no store write; a HOLDER/VIEW conflict fixture resolves to the holder.

### surface/I4 — one capability vocabulary
- Plugin and cowork agents expose capabilities through the **existing cross-host capability vocabulary** (the connector-host capability contract). No plugins-specific and no cowork-specific capability grammar is opened.
- This is the same discipline `SPEC_COWORK` already states ("no backend protocol invention"); surface/I4 makes it a surface invariant: an entry's actions are named in the one vocabulary or they are not surfaced.
- **Testable now:** a feed entry whose capability is outside the shared vocabulary is rejected/hidden, not rendered with an ad-hoc action.

### surface/I2 / surface/I5 — reserved, honored at feed time (gated)
Slice (a) is load-bearing for surface/I1, surface/I3, and surface/I4; surface/I2 and surface/I5 bind at operation/feed time, which is gated. The contract **reserves their places** so the later feed cannot bypass them:
- **surface/I2:** an entry's `status` distinguishes a **measured** presence signal from a last-known guess (a `measuredAt` vs assumed marker on the status). The port contract requires the source to say which.
- **surface/I5:** the existing `connection` field carries reachability. An operation on an unreachable counterpart must never look like success: it is **DÉPOSÉ-EN-ATTENTE** (deposited dormant for wake) or refused as **PAS-FAIT**, never reported as a silent success.

## 5. Capitalization split & acceptance-grid mapping

**LIB (sentropic ships):** `@sentropic/chat-ui` — the `AgentsList` component + the `AgentsFeedPort`/`AgentsEntry` contract (next minor after the current `0.30.0`; the exact version is set at publish, not welded here). The LIB **renders and defines the port**; it does not fetch, does not enroll, holds no host.

**INTEGRATION (each host wires):** the feed *source* behind the port — h2a presence, the plugins host, the cowork connector — is the enrolling integration, owned by h2a/hosts, not by the LIB.

Mapping to the h2a acceptance grid:
- **A. Recevabilité** — A1: this slice names a package (`@sentropic/chat-ui`) and declares the feed sources as **co-specification** (they consume the published port). A2: LIB **publishes** `AgentsFeedPort`; hosts **consume** it. A3: dependencies are the published `@sentropic/chat-ui` version, not a workspace path.
- **B. Frontière** — B1: the LIB does **not** enroll (renders + port only). B2: an integration does not re-implement the surface (it supplies rows). B3: no silent coexistence — a host either feeds the one port or is not on the surface (no parallel list); no duplicate or parallel-list object is known to this slice.
- **C. Ordre & sécurité** — this slice is contract-only; the remote-plane ordering/security (orientation 3) binds at (b)/Vague C via surface/I5 and the connector-account-workspace-exposure model, not here.

## 6. Dependencies & what is gated

- **BR-39l feed gap** (the real blocker for the *data*): the join `agent_definitions ↔ h2a instance/session presence` + a listing endpoint (`SPEC_EVOL_AGENTS_SURFACE.md:84,:205`, owners `api` + `h2a`). Until it lands, plugins/cowork/remote/perennial rows have no source; the port is exercised by fixtures.
- **0.90.1 storm-gate** blocks any lane launch (⇒ all build) and the h2a-presence half of the feed specifically.
- **Owner signature** gates all build regardless of the technical gate.
- Therefore: **buildable-now = the port contract + the surface component behavior + the surface/I1/surface/I3/surface/I4 fixture tests.** Gated = every real feed source.

## 7. Non-goals

- No build in this slice. No lane launched.
- Not volet (b): cowork's connected chat sessions + MCP-to-sentropic is a **connector-host connector** (sentropic = MCP client outbound), scoped via the connector-account-workspace-exposure model + L6 tenancy (#439/#492) — **Vague C, gated**. It is not this document and must not be conflated with `api/src/routes/api/mcp.ts` (#489), which is sentropic-as-MCP-**server** (inbound). Different plane.
- Not the R1 `chat → agents` breaking rename (L-A′, owner-GO, sequenced after the shell handover) and not the R10 all-workspaces build (#500, already approved) — those are existing agents-surface lots, not this cross-host contract.

## 8. Open items

- **O-1 (conductor owes):** orientations 1–4 are not yet in any transmitted artifact; provisional mapping places volet (b) under "orientation 3 (remote)" (grid C1: ordre/sécurité ↔ surface/I5 + Vague C gate). To be confirmed by h-cond; does not block this slice.
- **O-2:** the `reclaimOrMint` resume-path repair (surface/I1's *missing* half) is feed-time and out of this slice; this contract only reserves and targets the durable identity.
- **O-3:** exact `@sentropic/chat-ui` version bump is set at publish (post-signature), not welded here.
