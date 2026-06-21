# SPEC_VOL_FOCUS — `@sentropic/focus`: a focused-session document runtime (orient/steer a subject; decide = one modality)

Status: intent + proposal, 2026-06-20. Owner-named **`focus`** (rhanka): a Focus is *un temps de focus sur un
sujet particulier, pour orienter/piloter — décider étant UNE modalité* (parmi orienter / amender / commenter).
Generalizes the earlier "decision-dossier" framing: the decision-dossier is the FIRST focus TYPE, not the whole
concept. Brainstorm + double consensus Opus 4.8 + Codex 5.5 xhigh (CONVERGED). Supersedes the over-narrow
"LiveDocumentStore port over track" framing and the rejected name "livedoc". (Renames SPEC_VOL_DECISION_DOSSIER.)

## 1. The concept (owner)
A **Focus** = a focused working session ON A SUBJECT, rendered as a general, **renderable + interactive,
multi-surface document**, to **orient/steer** it. Outcomes have several **modalities**: a DECISION
(decision-dossier), an ORIENTATION, a spec AMENDMENT, a COMMENT/annotation. The owner can: revise/comment;
annotate/cercle (cerclage overlay, mermaid-editor lineage); drive Q/R validated with recommendations (préco) +
Claude-style accept/reject/comment on proposals/alternatives; integrable into ANY CLI, chat-ui, OR standalone.
The CORE must render in HTML or MD (CLI terminal OR web), Q/R in CLI or HTML; diagrams (mermaid/plantuml) in CLI
or HTML via diag's lib. A canevas type (live chat-ui interaction) is ONE legitimate mode, not the home. track =
DATA source (not storage); `@sentropic/focus` does the DOCUMENT model + RENDER + INTERACTION.

## 2. Decisions (owner 2026-06-20)
- **NAME = `@sentropic/focus`** (product "Focus"). [decision/decide were the alternatives; focus = the right
  altitude — a focus on a subject, decision a modality.]
- **FIRST SURFACE = CLI interactive driver + HTML/MD snapshot render (same milestone)**; chat-ui LAST (renderer-
  collision risk: `chat-ui/src/renderers` hotspot w/ BR-70 RF11 + BR-62).
- **TRACK INTERACTION EVENTS = new dedicated events as the TARGET, but STAGED (review-refined)**: M0 uses ONLY
  existing events (`decision.outcome`, `item.spec-amend`, `@sentropic/comments`, `decision.add-artifact`); the
  genuinely-NEW events (structured Q/R-answer-with-préco + cerclage-geometry) are co-designed with track LATER,
  behind contract fixtures + a track payload review — NOT in the dogfood. (Track D0, staged.)
- **PACKAGING = app-local-first (review-refined)**: M0 is a federated `stp track focus` subcommand (NOT a
  published `@sentropic/focus` package); the package is EXTRACTED only after the dogfood proves the API + a real
  consumer wires it (repo real-consumption rule). v1 MODEL = the CONCRETE decision-dossier, not a generic "Focus
  platform" (name stays `focus`; the model stays concrete until a 2nd modality is real).

## 3. Architecture (double-consensus, converged)
A **focused-session document RUNTIME** (NOT a doc platform): one neutral Focus AST + deterministic MD/HTML/
terminal renderers + ONE affordance-driven interaction-command contract, over track data.

- **Document model** = renderable+interactive AST `FocusDocument{ref,subject,title,hash,cursor,
  sections:FocusNode[],interactions:Affordance[],provenance,amendmentTrace}` with stable node ids + `targetRef`
  (every rendered element = an interaction target). Node families: `subject`/`context`; `prose` (markdown body);
  `question` (q + recommended answer/préco + validation state); `optionSet`/`option` (alternatives/proposals w/
  accept|reject|comment annotations); `annotation`; `cerclage` (overlay target+geometry; reuse mermaid-editor
  lineage, not the doc model); `outcome` (modality-tagged: decision|orientation|amendment|comment);
  `comprehensionEvidence` (from dossier artifacts VERBATIM — subject/dossierHash/sig intact, NOT lineage —
  confused-deputy fix); `amendmentTrace` (ordered AmendmentStep[]); `diagram` ({syntax:mermaid|plantuml,source,
  alt,hints}). The **decision-dossier** = a FocusDocument whose primary outcome modality is a decision; it maps
  to track `DecisionDossierView{outcome,dossier,comprehensionEvidence}` + `amendmentTrace`.
- **Render** = `track read → FocusDocument → MD | HTML | terminal`. MD/HTML from an mdast/hast-compatible content
  sub-tree; **FRESH small mdast/rehype core** (verified: NO local `@sentropic/doc`; current markdown reuse is
  injection-based, hosts supply `marked` — `chat-ui/markdown-refs.ts:183`). Renderer core = hooks; hosts own
  sanitization/styling. **Diagram = a PORT** `DiagramRenderer.render(node,target)` — diag's `render_mermaid` is
  the FIRST adapter, not a hard dep (HTML=SVG/PNG, MD=fenced+links, terminal=text/unicode/image-protocol).
- **Interaction** = ONE **affordance-driven** command contract (submit `action{name}` only from
  `snapshot.affordances`; adapter maps name→track WorkEventKind; NEVER invent kinds — per the frozen port):
  `FocusCommand = answerQuestion | validateRecommendation | annotateOption | addComment | addCerclage |
  amendSpec | ratifyOutcome`. OCC: baseHash → re-read → pure `reconcile`. New events (answer/annotate/comment/
  cercle) = track D0 (co-design).
- **Packaging** = ONE package **`@sentropic/focus`** (core model+renderers+command contract+diagram port; no
  Svelte, no storage) + subpaths `/track` (adapter over `@sentropic/track` read+ingest) + `/cli` (headless
  driver); chat-ui integration via the existing `RendererRegistry`; standalone web later. ONE package first
  (repo rule: new packages need real consumption). **Relation to the frozen `LiveDocumentStore` port = LAYER ON
  it** (the live/chat driver uses read/watch/submit/reconcile; do NOT absorb or drop).
- **Reuse**: track (data+writes) · diag (first DiagramRenderer adapter) · mermaid-editor (cerclage lineage, no
  fork) · chat-ui RendererRegistry (live embed) · `@sentropic/comments` (target-kind vocab
  message|canvas|artifact|field|record; canonical comments still = track events) · fresh mdast core. NET-NEW =
  FocusDocument model + the command contract + CLI/HTML drivers.

## 4. Build plan — REVISED after the adversarial double review (Opus 4.8 + Codex 5.5xhigh, 2026-06-20)
The double review = **NO-GO on the original M1** (it bundled a new published package + new track events + 3
renderers + CLI writes + diagrams + cerclage + comments into one milestone, and treated SPEC-ONLY / CROSS-REPO /
non-existent things as local). Verified blockers: the `LiveDocumentStore` port is still a `_kind` STUB in code
(`chat-core/ports.ts:70`); track's `DecisionDossierView` is `outcome + dossier(OPAQUE) + report/rollup +
generic affordances` — the typed Q/R/option/cerclage/diagram FocusNodes are NOT proven to exist in track reads;
track is CROSS-REPO (`@sentropic/track/cli`, no local submit port); `@sentropic/comments` already owns comments;
`render_mermaid` is a `StandaloneToolSource`, NOT a render lib (and not even a chat-ui local tool in the working
tree); static MD/HTML cannot watch/submit/reconcile. → REDUCE to a dogfood slice.

**M0 dogfood (the minimal first cut — GO):**
1. **`stp focus <decision-id>`** (a federated CLI subcommand backed by a PRIVATE `packages/focus` — app-local,
   NOT yet published) reads a track `DecisionDossierView` and renders it READ-ONLY to **terminal + MD + static
   HTML (ALL THREE; HTML is MANDATORY to implement, not optional)**, incl. the amendment trace + the existing
   generic affordances.
2. Render uses the EXISTING markdown injection pattern (host supplies `marked`) — **NO mdast core**.
3. ONE optional WRITE: `ratifyOutcome` (→ `decision.outcome`) OR `amendSpec` (→ `item.spec-amend`) — mapped to
   EXISTING track events. **NO new track events.**
4. Diagrams: **MD fenced fallback only** (no diagram adapter; the diag chat-tool is NOT a headless renderer).
5. **NO** cerclage, **NO** live HTML, **NO** new published package, **NO** new track events.
6. EXTRACT `@sentropic/focus` ONLY after the dogfood proves the API + a real consumer wires it (repo
   real-consumption rule).

**Staged after the dogfood proves the concept (each gated, contract-snapshotted):**
- the genuinely-NEW track interaction events (structured Q/R-answer-with-préco + cerclage-geometry) —
  co-designed with track BEHIND contract fixtures + a track-side payload review (NOT in M0); comments/annotations
  REUSE `@sentropic/comments` unless proven insufficient.
- a fresh mdast/rehype core ONLY if AST transforms are genuinely needed (else keep injection).
- the live drivers: dynamic web + chat-ui (LAYER on the LiveDocumentStore port — once that port is actually
  IMPLEMENTED, not a stub). chat-ui LAST.
- a real headless DIAGRAM renderer (mermaid-cli / kroki / plantuml) behind a surface-specific adapter.
- the `@sentropic/focus` package extraction.

**Split confirmed**: `FocusSnapshot` (read-only MD/HTML/terminal — disabled-affordance metadata only) vs
`FocusLiveSession` (CLI loop / dynamic web / chat-ui — the live commands). Cerclage = surface geometry, NOT
document truth → deferred to web/canvas or modeled as comments-with-surface-anchors. Align the CLI/terminal
render with ARCH-21 `resource_terminal` / RF11 renderer (don't duplicate).

## 4b. M1 dogfood — BRANCH PLAN (owner-requested 2026-06-21)
Home = a PRIVATE `packages/focus` (`"private": true`, app-local; un-private → publish `@sentropic/focus` LATER
when a real external consumer wires it) + a `stp focus` federated subcommand. Consumes `@sentropic/track` (npm
dep). NO new track events, NO new public package, NO cerclage, NO live drivers, NO mdast core (inject markdown),
diagrams = fenced fallback. Decided refinements applied: events STAGED, app-local-first, HTML MANDATORY.

| Lot | Branch | Deliverable | Gates / depends-on | ∥ |
|---|---|---|---|---|
| **L1** | `feat/focus-render-core` | PRIVATE `packages/focus`: the CONCRETE `DecisionDossierDocument` model + the **terminal + MD + HTML renderers (all 3, HTML mandatory)**, driven by a `DecisionDossierView` FIXTURE (incl. amendment-trace + existing affordances). Markdown via injection (host-supplied `marked`); HTML sanitized via a host hook; diagrams = fenced MD fallback. Pure + unit-tested on the fixture. | none (fixture-driven) | L2 |
| **L2** | `feat/focus-track-read` | `packages/focus` `/track` read binding (`@sentropic/focus/track`): `new TrackReader(eventsPath).canevas(workspace, { baselineCommit, decisionId }).dossier` (a `@sentropic/track/read` `DecisionDossierView`) + `amendmentTrace(decisionId)` → `DecisionDossierDocument`. Real decision by id. Binds the **versioned `/read` subpath** (NOT track's barrel), gates on `reader.contractVersion`. Reads are PURE/read-only/clockless — NO auth/identity (the `readAt` timestamp is caller-supplied). **SHIPPED 2026-06-21** (focus 0.2.0; track ^0.17.0, READ contract 1.11.0). | L1 model; `@sentropic/track` dep | L1 |
| **L3** | `feat/focus-cli-readonly` | `stp focus <decision-id>` federated subcommand (read-only): read (L2) → render terminal / `--format md` / `--format html` (mandatory). The first usable end-to-end dogfood. | L1 + L2; `@sentropic/cli` federation wiring | — |
| **L4** | `feat/focus-cli-write` | The ONE write: a CLI Q/R prompt → `ratifyOutcome`→`decision.outcome` OR `amendSpec`→`item.spec-amend` via `@sentropic/track/ingest` (auth-by-context; CLI carries the user/workspace identity). Read-back to confirm. | L3; track ingest auth model | — |

Merge order: **L1 → L2 → L3 → L4** (L1/L2 partly parallel: L1 on the fixture, L2 the read binding; L3 needs both; L4 needs L3). Each lot: scoped tests + a `make`/CI gate; `packages/focus` private so publish jobs skip (enforce-package-bump still applies → bump patch). MUST-NOT: introduce a new track event, publish the package, or add a live/cerclage/diagram-adapter path in M1.
Open in the plan: the **CLI write identity model** (L4 — how the headless `stp focus` carries the user/workspace for `./ingest` auth-by-context) — coordinate with the auth/track lanes.

**L2 REAL `@sentropic/track/read` contract (verified against `@sentropic/track@0.17.0`, READ contract `1.11.0`; L1's mirror was wrong on 2 points — corrected here, the binding is the source of truth):**
- `TrackReader(eventsPath)` is the read entrypoint. `reader.contractVersion` = the additive-only READ contract semver; consumers gate on it. `reader.canevas(workspace, { baselineCommit, decisionId }).dossier` returns the `DecisionDossierView` (present iff `decisionId` is supplied). `reader.amendmentTrace(decisionId)` returns the ordered `AmendmentStep[]`. `reader.cursor()` gives `{ head, count }` (the host's liveness primitive).
- `DecisionDossierView = { id: ItemId; title: string; workspace: string; outcome: Outcome; dossier: Dossier }` — **carries `id`/`title`/`workspace`** (L1 missed them) and has **NO top-level `comprehensionEvidence`** (L1 wrongly placed it as a sibling).
- `Outcome = 'pending' | 'go' | 'no-go' | 'deferred'`.
- `Dossier = { context: string; options: Option[]; qa: QAEntry[]; selectedOptionId?; recommendation?: { optionId; rationale }; resultingSpecChange?; decisionEvaluation?; artifacts?: DossierArtifact[] }`; `Option = { id; title; summary; pros?; cons? }`; `QAEntry = { id; question; answer? }`.
- **`ComprehensionEvidence` is NESTED, not a sibling:** `dossier.artifacts[]` is a discriminated union → on `kind:'h2a-decision-dossier'` → `.comprehension?: ComprehensionEvidence[]`. `ComprehensionEvidence = { subject; dossierHash; h2aEventRef?; attestationHash?; sig?; at? }`. **Anti-confused-deputy invariant:** `subject` = the NAMED attester/decider — DISTINCT from the channel `prov.principal` that merely RELAYED the write; the binding surfaces the attester, never laundering the origin into the relayer.
- `amendmentTrace(decisionId): AmendmentStep[]` ordered by `seq` over the aggregate's `spec.amended` / `dossier.revised` / `decision.artifact-added` / `decision.outcome` events. `AmendmentStep = { seq; at; by; kind; prov; origin: 'human'|'machine'; summary?; patchRef?; proposalRef? }`; `origin` derives PURELY from `prov.proposed` (machine never laundered).

## 5. Open
- The exact NEW track ingest events (answer/annotation/comment/cerclage payloads) — co-design with track (next).
- Diagram terminal rendering fidelity (mermaid/plantuml in a CLI).
- Lane assignment for the build (conductor offline → owner/conductor confirm).

## 6. Review log
- 2026-06-20: intent captured; M5 "LiveDocumentStore port" framing corrected → a Focus document runtime (keep a
  lib; drop "livedoc"; canevas/chat-ui = one mode). Double consensus Opus 4.8 + Codex 5.5 xhigh CONVERGED.
  Owner: name=`@sentropic/focus` (decision=one modality), CLI-first, new dedicated track events. Codex
  corrections adopted: no local @sentropic/doc (fresh mdast core); LAYER on the frozen port; new track events
  are a track D0.
- 2026-06-20 (review): **adversarial double review Opus 4.8 + Codex 5.5xhigh — NO-GO on the original M1**, GO on
  a reduced dogfood (§4). Verified falsifications: LiveDocumentStore = `_kind` stub (not implemented);
  DecisionDossierView is opaque dossier (typed Q/R/option/diagram nodes NOT proven in track reads); track is
  cross-repo (no local submit port); `@sentropic/comments` already owns comments; `render_mermaid` is a
  StandaloneToolSource not a render lib; static MD/HTML can't watch/submit/reconcile; new package violates the
  real-consumption rule; chat-ui working tree = 0.20.0 (not 0.22.0). REVISED: M0 = app-local `stp track focus`
  read-only render + 1 write via existing events; NO new package / events / cerclage / live-HTML / diagram
  adapter / mdast core; concrete decision-dossier (not generic Focus platform); split FocusSnapshot vs
  FocusLiveSession; align ARCH-21. Reviews: `.tmp/focus-review-{opus,codex}.md`.
