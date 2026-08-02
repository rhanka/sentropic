# SPEC_EVOL — Agents-Surface Cross-Host Fusion Contract (D6 slice a)

## 0. Status & framing

- **This is D6 slice (a), design-only.** It *poses* the contract. It launches no lane and specifies no build. The storm-gate (h2a runtime 0.90.1) holds and **no build precedes owner signature** (D6 process).
- **Flow this document is entering:** architect poses (this file) → h2a-architect evaluation against the 6′ surface contract → conductor consolidation → **owner signature**. Only then, gated on 0.90.1, does any build begin.
- **Why this is a repo spec and not an h2a message:** the 6′ invariants (I1–I5), the D6 plan, and orientations 1–4 currently live **only** as h2a review messages, in no repo file. That fragility is the reason this contract is captured durably here. §2 pins I1–I5 verbatim into the repo for the first time.
- **Relation to existing specs:** `spec/SPEC_EVOL_AGENTS_SURFACE.md` defines the **chat-side** surface (tabs `agents | chats | comments`; absorbing sessions, jobs, remote, CLI — items R1–R15). This document is the **cross-host** layer *above* it: the contract by which **plugins** and **cowork** agents become entries on the *same* surface, under I1–I5. It does not restate R1–R15; it constrains how any host's agents join the one surface.
- **Capitalization split (D6):** sentropic ships the **LIB** (the surface component + the feed *port*); each host wires the **INTEGRATION** (the feed *source* that enrolls its agents). This document specifies the LIB contract and the port; it does not specify any host's integration.

## 1. Objective

One agents surface, not two (nor five). Today cowork agents, plugins, chat sessions, queue jobs, and CLI transcripts are — or would be — surfaced through separate lists. This contract makes them **entries on a single `AgentsFeedPort`**, rendered by a single `AgentsList`, each carrying enough contract to satisfy I1–I5 regardless of which host holds it.

Non-goal here: the *data* for remote/perennial/plugin/cowork agents. That is the BR-39l feed gap (§6), gated. This slice delivers the **contract and the port**, buildable and reviewable now; the feed sources land after the gate.

## 2. The 6′ surface contract (I1–I5) — pinned verbatim

Frozen by the sentropic architect (h2a review `env__6prime-5invariants-for-9a`, I1 corrected in `env__6prime-I1-correction`). Authoritative copy:

- **I1 — UN SEUL IDENTIFIANT traverse la frontière, PAS un id de conversation.** Un emplacement d'identité durable, jamais un id éphémère soudé. L'identité durable existe déjà (`reclaimOrMint`, reprise sur PREUVE DE POSSESSION) ; ce qui MANQUE = son chemin de reprise, défaillant car il apparie sur `host+providerSessionId` qui change à chaque conversation → reprise jamais déclenchée, identité neuve frappée en silence. RÉSERVER LA PLACE = cibler l'identité reprise (une fois le chemin réparé), ne rien souder en attendant.
- **I2 — La surface DIT, opération par opération, ce qui est MESURÉ vs cru sur parole.**
- **I3 — Chaque objet marqué DÉTENTEUR ou VUE ;** un renderer ne persiste jamais ; une vue ne fait pas autorité en cas de désaccord.
- **I4 — Capacités dans le VOCABULAIRE EXISTANT** (contrat de capacités cross-hôte) ; ne pas en ouvrir un second.
- **I5 — Chaque opération déclare son comportement quand la contrepartie est INJOIGNABLE ; défaut = REFUSER** (pas de best-effort, pas de repli silencieux).

## 3. The fusion model

**One port.** The surface consumes exactly one `AgentsFeedPort` (already defined at `packages/chat-ui/src/state/agentsEntry.ts`): `list(scope) → readonly AgentsEntry[]` with an optional `subscribe`. Hosts do not each get a bespoke list; they each get to be a **feed source** behind the one port.

**Entries are kinds, not surfaces.** `AgentsEntryKind = 'agent' | 'session' | 'remote' | 'job' | 'run'`. A plugin agent and a cowork agent are `AgentsEntry` rows (`kind:'agent'` or `kind:'remote'`) with a `connection` marker and a `hostKind` — **not** a second component. The fusion is: cowork and plugins each contribute rows to the same port; `AgentsList` renders the union.

**Provenance is explicit.** Every entry declares its `hostKind` (which host holds it) and its `connection` (reachability/link state). These two fields are the carriers for I2/I3/I5 at render time.

## 4. I1 / I3 / I4 compliance (owner-named for slice a)

### I1 — durable identity, reserved not welded
- `AgentsEntry` **reserves** a durable-identity slot (`agentRef`) distinct from any per-conversation/session id. The feed keys an agent on `agentRef`, never on `providerSessionId` or a conversation id.
- The contract records the known defect it must not re-introduce: the `reclaimOrMint` resume path matches on `host+providerSessionId` (changes every conversation), so reprise never fires and a fresh identity is minted silently. **This slice reserves the slot and TARGETS the resumed identity; it does not weld a conversation id in the meantime, and it does not attempt to repair the resume path** (that repair is out of scope, feed-time).
- **Testable now:** a fixture feed with two conversations of the *same* durable agent must collapse to **one** `AgentsList` row (same `agentRef`), never two.

### I3 — holder vs view, renderer never persists
- Every `AgentsEntry` is marked **HOLDER** or **VIEW**. A cowork/plugin agent rendered in sentropic is a **VIEW** (the holder is the cowork/plugin host). A sentropic-owned chat session is a **HOLDER**.
- `AgentsList` (and any renderer) **persists nothing** about a VIEW entry — no local write-back of a foreign agent's state.
- **On disagreement the holder wins:** if the sentropic view and the holder differ, the surface reflects the holder or marks the entry stale (I5), never overrides the holder from the view.
- **Testable now:** a renderer given a VIEW entry performs no store write; a HOLDER/VIEW conflict fixture resolves to the holder.

### I4 — one capability vocabulary
- Plugin and cowork agents expose capabilities through the **existing cross-host capability vocabulary** (the connector-host capability contract). No plugins-specific and no cowork-specific capability grammar is opened.
- This is the same discipline `SPEC_COWORK` already states ("no backend protocol invention"); I4 makes it a surface invariant: an entry's actions are named in the one vocabulary or they are not surfaced.
- **Testable now:** a feed entry whose capability is outside the shared vocabulary is rejected/hidden, not rendered with an ad-hoc action.

### I2 / I5 — reserved, honored at feed time (gated)
Slice (a) is I1/I3/I4-load-bearing; I2 and I5 bind at operation/feed time, which is gated. The contract **reserves their places** so the later feed cannot bypass them:
- **I2:** an entry's `status` distinguishes a **measured** presence signal from a last-known guess (a `measuredAt` vs assumed marker on the status). The port contract requires the source to say which.
- **I5:** the `connection` field carries an explicit **unreachable** state; the surface renders it as such and any *operation* on an unreachable entry defaults to **REFUSE** — no best-effort. (Operations are gated; the field and the default are fixed here.)

## 5. Capitalization split & acceptance-grid mapping

**LIB (sentropic ships):** `@sentropic/chat-ui` — the `AgentsList` component + the `AgentsFeedPort`/`AgentsEntry` contract (next minor after the current `0.30.0`; the exact version is set at publish, not welded here). The LIB **renders and defines the port**; it does not fetch, does not enroll, holds no host.

**INTEGRATION (each host wires):** the feed *source* behind the port — h2a presence, the plugins host, the cowork connector — is the enrolling integration, owned by h2a/hosts, not by the LIB.

Mapping to the h2a acceptance grid:
- **A. Recevabilité** — A1: this slice names a package (`@sentropic/chat-ui`) and declares the feed sources as **co-specification** (they consume the published port). A2: LIB **publishes** `AgentsFeedPort`; hosts **consume** it. A3: dependencies are the published `@sentropic/chat-ui` version, not a workspace path.
- **B. Frontière** — B1: the LIB does **not** enroll (renders + port only). B2: an integration does not re-implement the surface (it supplies rows). B3: no silent coexistence — a host either feeds the one port or is not on the surface (no parallel list).
- **C. Ordre & sécurité** — this slice is contract-only; the remote-plane ordering/security (orientation 3) binds at (b)/Vague C via I5 and the connector-account-workspace-exposure model, not here.

## 6. Dependencies & what is gated

- **BR-39l feed gap** (the real blocker for the *data*): the join `agent_definitions ↔ h2a instance/session presence` + a listing endpoint (`SPEC_EVOL_AGENTS_SURFACE.md:84,:205`, owners `api` + `h2a`). Until it lands, plugins/cowork/remote/perennial rows have no source; the port is exercised by fixtures.
- **0.90.1 storm-gate** blocks any lane launch (⇒ all build) and the h2a-presence half of the feed specifically.
- **Owner signature** gates all build regardless of the technical gate.
- Therefore: **buildable-now = the port contract + the surface component behavior + the I1/I3/I4 fixture tests.** Gated = every real feed source.

## 7. Non-goals

- No build in this slice. No lane launched.
- Not volet (b): cowork's connected chat sessions + MCP-to-sentropic is a **connector-host connector** (sentropic = MCP client outbound), scoped via the connector-account-workspace-exposure model + L6 tenancy (#439/#492) — **Vague C, gated**. It is not this document and must not be conflated with `api/src/routes/api/mcp.ts` (#489), which is sentropic-as-MCP-**server** (inbound). Different plane.
- Not the R1 `chat → agents` breaking rename (L-A′, owner-GO, sequenced after the shell handover) and not the R10 all-workspaces build (#500, already approved) — those are existing agents-surface lots, not this cross-host contract.

## 8. Open items

- **O-1 (conductor owes):** orientations 1–4 are not yet in any transmitted artifact; provisional mapping places volet (b) under "orientation 3 (remote)" (grid C1: ordre/sécurité ↔ I5 + Vague C gate). To be confirmed by h-cond; does not block this slice.
- **O-2:** the `reclaimOrMint` resume-path repair (I1's *missing* half) is feed-time and out of this slice; this contract only reserves and targets the durable identity.
- **O-3:** exact `@sentropic/chat-ui` version bump is set at publish (post-signature), not welded here.
