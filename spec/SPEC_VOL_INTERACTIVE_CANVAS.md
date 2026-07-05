# SPEC_VOL_INTERACTIVE_CANVAS — raw intent: live canvas, agent-scope awareness, CLI integration, track/dossier as canvas

Status: **RAW INTENT CAPTURE** (SPEC_VOL = volition / raw owner intent, NOT a
reviewed study). Created 2026-06-09. Held here so the intent is not lost while
the `track` system is being made functional. To be PROMOTED to SPEC_EVOL
study(ies) under the double adversarial review cadence (Opus 4.8 + Codex 5.5
xhigh) + batched owner decisions once track works. No decisions are taken in
this file — it records what the owner wants, verbatim-faithful, with anchors
to already-decided pieces.

## 1. Why this exists

The owner expressed a set of cross-cutting intentions around INTERACTIVE
CANVAS surfaces, background-agent awareness, and CLI integration that span
several decided studies (ARCH-16 canvas, ARCH-21 Resource Plane, ARCH-09
track/decision-dossier, the diag/mermaid-editor annotation work, and the h2a
scope/track model). Track is not yet functional as a registry, so this captures
the intent rather than dispatching it.

## 2. Raw intentions (faithful to the owner)

**I1 — Live canvas editions vs background-agent filesystem mode; live is
PREFERRED.** An object can be acted on two ways: (a) LIVE, through an
interactive canvas (a human, or a foreground turn, editing directly); (b) by a
BACKGROUND agent through the Resource Plane FILESYSTEM mode (ARCH-21:
`ls/read/edit/grep` over `ResourceRef`s). When a live interaction is possible,
LIVE editions SHOULD BE PREFERRED over the filesystem path. The filesystem mode
is the headless/background affordance; the canvas is the human/foreground
affordance.

**I2 — Background-agent scope awareness on a visualized object.** If a
background agent IS working — or PLANS to work (a declared *scope of work*) —
on an object the user is CURRENTLY VISUALIZING, the USER MUST BE MADE AWARE
(a live presence / lock / notice on the canvas). The notion of an agent's
*scope* is normally framed by **h2a / track** (the scope-of-work is an h2a
ENGAGEMENT / a track work item carrying a scope). So the canvas should read the
agent's declared scope from h2a/track and surface "agent X is working / plans
to work on this object", with the appropriate concurrency posture.

**I3 — Integrate ALL our CLIs as first-class surfaces.** `stp` (the wrapper),
`h2a` (agent coordination), `track` (work / coherence registry), `harness`
(neutral code-work / PR workflow — when coding). These should be reachable and
visualizable inside Sentropic (most naturally via the Resource Plane mounts +
canvas), not external-only tools.

**I4 — The track Kanban view IS a canvas.** Not a read-only dashboard: the AI
can UPDATE the board, AND the human CREATES actions via the view
(bidirectional — AI writes + human-authored actions). The kanban is an
interactive canvas backed by track work items.

**I5 — The decision dossier IS an interactive canvas.** Decision validation
(human approves / amends), and potentially LIVE spec amendment with
HUMAN/MACHINE DIFF TRACKING (provenance of every change: who/what edited what —
human edit vs machine edit, tracked). The dossier is where decisions are
ratified and specs are amended in-place with a tracked diff.

**I6 — A very rich, REUSABLE canvas module in Sentropic, co-designed WITH
track.** It must reuse the "circling" / annotation capability currently owned
by **diag (mermaid-editor)** — i.e. lift that annotation/circling primitive out
of diag into a reusable canvas module that track (kanban, dossier), diag, and
future apps all consume. The module is the shared interactive-canvas +
annotation substrate.

## 3. Anchors to already-decided pieces (context, not decisions)

- **ARCH-16 canvas runtime** (`SPEC_EVOL_CHAT_CANVAS`, gated): `LiveDocumentStore`
  edit-back is where LIVE editions (I1) and live spec amendment (I5) land.
- **ARCH-21 Resource Plane** (`SPEC_EVOL_RESOURCE_FS`, RF1-RF11): the FILESYSTEM
  mode for background agents (I1); RF11 `ToolInteractionTrace` + the per-tool
  `customRenderer` slot within the unified contract is the viz seam these
  canvas surfaces plug into; "prefer live" = when a human is viewing an object,
  prefer the canvas edit-back over the bg filesystem edit on the same object.
- **h2a scope / ENGAGEMENT + track work-item scope**: the source of truth for
  "an agent is working / plans to work on this object" (I2). Agent scope is
  framed by h2a/track per the B2B2B/MANDATE model.
- **ARCH-09 track + decision dossier** (`SPEC_EVOL_TRACK_DECISION_DOSSIER`):
  the kanban (I4) and dossier (I5) canvases are this study's surfaces; ARCH-09
  currently depends on the event spine (ARCH-14) + real event sources.
- **diag / mermaid-editor circling/annotation**: the existing annotation
  primitive to lift into the reusable module (I6).
- **CLIs**: `stp`/`h2a`/`track`/`@sentropic/harness` (the latter the neutral
  code-work/PR layer) — surfaced via Resource Plane mounts + canvas (I3).

## 4. Open questions to study later (when track works)

- **Concurrency model** for I1+I2: when a human edits live AND a bg agent holds
  a scope on the same object — lock (deny the agent), CRDT merge, or
  present-and-warn (live wins, agent yields)? "Live preferred" suggests
  live-wins + agent-yield + user-notice, but the exact posture needs a study.
- **Module home/shape (I6)**: a new `@sentropic/canvas` package? part of
  `@sentropic/chat-ui`? where do the kanban + dossier + annotation/circling
  live, and how does diag migrate onto it without regressing? (consumer
  co-design with diag/mermaid-editor + track owners.)
- **Human/machine diff provenance (I5)**: the model for tracking who/what
  amended a spec live (ties to the UBO envelope `origin` field + an edit
  provenance trace; reuse RF11 `ToolInteractionTrace`?).
- **Track kanban ↔ work items ↔ h2a engagements (I4/I2)**: how human-authored
  kanban actions become track work items and/or h2a engagements, and how agent
  scope reads back onto the board and the canvas.
- **CLI surfacing (I3)**: which CLI surfaces become Resource Plane mounts /
  canvas renderers vs stay terminal-only (ties to RF10 `resource_terminal` /
  `local_bash` / `remote_bash`).

## 5. Promotion path

When track is functional, promote this to:
- amendments to ARCH-16 (live edit-back + concurrency vs bg filesystem),
- amendments to ARCH-09 (kanban-as-canvas, dossier-as-canvas, human/machine
  diff provenance),
- a new study for the **reusable interactive-canvas + annotation module**
  (candidate ARCH-22) co-designed with track + diag,
- an articulation note for CLI surfacing in ARCH-21 (Resource Plane).
Each under the double-review + batched-decision cadence. Until then: RAW.
