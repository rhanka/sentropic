# SPEC_EVOL — Chat-UI Turnkey Dialogue (`ChatConversation`)

Status: STUDY (feasibility) — awaiting sentropic owner review before h2a counteroffer.
Owner: `sentropic-chat` (chat-domain studies agent).
Source: h2a negotiation `nego:chatui-turnkey-dialogue` (scope `scope:chat-ui`), requested by `claude:mermaid-editor` (`rhanka/drawing-skills`). `sentropic-chat` is the required signer; comprehension attested (seq 1, non-binding).
Also feeding this study: a second related request from **immo (`claude:radar-immobilier`) is awaited** (not yet received), and an owner directive that the turnkey surface be **both DS-adaptable and exact-by-default** in the **BR-42** lineage (see §6b). The counteroffer is held until the immo request lands so all asks harmonize.
Lineage: **BR-38c family** — this is the proposed **BR-38d** continuation of BR-38c (turnkey vision/attachment defaults), with its theming surface co-designed in the **BR-42** design-system track. It MUST NOT fork a divergent line.

---

## 1. The ask (verbatim intent)

Publish a **turnkey, app-agnostic 1:1 chat dialogue** from `@sentropic/chat-ui` (e.g. `./components/ChatConversation.svelte`) that renders the exact sentropic UX — timeline + streaming messages + composer + tool-call cards + bubble/docked layout — parameterized by:

- `transport` (via `createDefaultTransport(baseUrl)`),
- a web `HostAdapter`,
- a `LocalToolsAdapter` (custom local tools),
- `sessionId` / bootstrap,

**without** mandatory workspace / auth / comments / jobs coupling (those optional / feature-flagged).

Why now: drawing-skills must present the chat dialogue 1:1 with sentropic; the `render_mermaid` local-tool pause/resume handoff is already proven against the real chat-ui parser (`parsePendingLocalToolCallsFromStatusPayload`). Only the turnkey dialogue export is missing. Fallback if declined: drawing-skills hand-composes `ChatPanel + ChatTimeline + ChatComposer + StreamMessage` itself — approximate, not 1:1.

## 2. Current state (verified on `main` + PR #203)

`@sentropic/chat-ui@0.1.2` already publishes the **primitives** the assembly needs:

- Components: `ChatTimeline`, `ChatComposer`, `StreamMessage`, plus shells `ChatPanel` (snippet boundary), `ChatWidget`.
- Client: `client/transport`, `client/replay`, `client/streamHub` (+ `createStreamHub(options)`), `client/streamTypes/streamHistory`.
- State: `state/chatProjection`, `state/chatDraft`, `state/chatAttachments`, `state/streamMessageProjection/Smoothing`, `state/chatWidgetShell`.
- Hosts: `hosts/types` (`ChatUiHostAdapter`), `hosts/createWebHost`.
- Local tools: `stores/localTools` (`createLocalToolsStore`), `utils/localToolStreamSync`, `parsePendingLocalToolCallsFromStatusPayload`.
- Renderers: `renderers/registry` (`RendererRegistry`, `ToolResultRenderer`).
- Utils: `chat-steer` (`postChatSteer`), `chat-run-projection`, `chat-tool-scope`.

What is **missing**: the *assembly* — the single component that wires these into the exact 1:1 dialogue. Today that assembly lives only in the **app-owned, unpublished** `ui/src/lib/components/chat/AppChatPanel.svelte` (**5991 lines**), which is deeply app-coupled. Reference counts in that file:

| concern | refs | concern | refs |
| --- | ---: | --- | ---: |
| `session` | 237 | `localTool` | 174 |
| `comments` | 87 | `document` | 77 |
| `workspace` | 57 | `folder` | 27 |
| `organization` | 13 | `auth` | 10 |

Direct app imports include `$lib/stores/session|folders|organizations|initiatives|workspaceScope|streamHub`, `@sentropic/cowork-bridge/core`, Google-Drive picker, docx/markdown utils, `EditableInput`, `DocumentSourceMenu`, `MenuPopover`.

## 3. Feasibility verdict

**Feasible and architecturally consistent — but NOT a lift-and-shift of `AppChatPanel`.**

`SPEC_STUDY_CHAT_UI_SDK_SCOPE.md` drew the package/app boundary **deliberately**: `ChatPanel` (package) is a shell boundary and "the full Sentropic session orchestration remains app-owned" (l.107); `AppChatPanel` owns orchestration/REST/comments/documents/local-tool continuation/history (l.113); Non-Goal: "No behavior change or code movement before this package boundary is accepted" (l.320).

The request does **not** require crossing that boundary in the wrong direction (it does NOT ask for the app-coupled orchestration to be published). It asks for a **new reference assembly** that composes the already-published primitives into the 1:1 UX, with the app concerns expressed through the **slots the boundary already defines** (`RendererRegistry`, `ChatUiHostAdapter`, snippets, injected adapters). That is a net-additive deliverable in the same architectural grain — the natural "turnkey" capstone of BR-14a → BR-38c.

Risk/effort: **medium**. The hard part is identifying which `AppChatPanel` behaviors are already pure (in package) vs app-coupled, and re-expressing the coupled ones as optional injected adapters/renderers — not rewriting the UX.

## 4. Branch lineage & harmonization with BR-38c (load-bearing)

User directive: *harmonize the two evolutions in the same branch lineage (38c or 38c+d) — do both, no divergent branch.*

- **BR-38c (in flight, owned by session `38etc`)** = turnkey **attachment/vision** defaults: default attachment tray + image lightbox + reference web upload host, moved into `@sentropic/chat-ui` and consumed by the app (zero dual-path). Narrow, mid-execution.
- **BR-38d (proposed, this study)** = turnkey **dialogue assembly** `ChatConversation.svelte` that composes the primitives **and** BR-38c's attachment defaults into the full 1:1 dialogue, with workspace/auth/comments/jobs/documents/drive optional.

**No duplication**: BR-38c's tray/lightbox/upload become *components consumed by* BR-38d's assembly. BR-38d **depends on** BR-38c (the assembly needs the attachment defaults to be 1:1). They are sequential in one lineage.

**Recommended: 38c → 38d sequence** (do not widen 38c mid-flight). Keep 38c scoped as-is; land it; then BR-38d builds the assembly on top. Alternative (fold the dialogue assembly into 38c) only if 38etc has not progressed and the owner prefers a single branch — but that re-scopes an executing branch and risks it. → **Decision D1 (§10) for the owner.**

## 5. Proposed deliverable — `@sentropic/chat-ui/components/ChatConversation.svelte`

A single turnkey component. Required props (minimal turnkey path):

```ts
interface ChatConversationProps {
  host: ChatUiHostAdapter;            // transport + streamClient (+ optional localTools/auth/nav/storage/contextProvider/renderers)
  sessionId?: string;                 // omit → component creates a session via host.transport.createSession
  layout?: 'docked' | 'floating' | 'inline';   // default 'inline'
  localTools?: LocalToolHostAdapter;  // custom local tools (e.g. render_mermaid) — if not already on host
  renderers?: RendererRegistry;       // extra tool-result renderers; package defaults always registered
  // feature flags — ALL default OFF so the turnkey path stays app-agnostic:
  features?: {
    attachments?: boolean;            // BR-38c tray + lightbox + reference upload (default ON when host.uploadAttachment present)
    comments?: boolean;               // off → no comment mode / mention UI
    documents?: boolean;              // off → no document-source menu / session-docs
    jobs?: boolean;                   // off → no queue/jobs panel
    workspaceScope?: boolean;         // off → no workspace RBAC gating
    steer?: boolean; retry?: boolean; stop?: boolean;  // default ON (pure, already in primitives)
  };
  labels?: ChatUiLabelDictionary;     // i18n strings injected (no app-local locale dependency)
}
```

It internally wires: `createStreamHub` (from host) → `chatProjection` → `ChatTimeline` (+ `StreamMessage`, package renderers) → `ChatComposer` (+ BR-38c attachment tray when enabled) → `localTools` handoff (`parsePendingLocalToolCallsFromStatusPayload` + `submitToolResult`) → steer/stop/retry via `postChatSteer`/transport. App-coupled concerns mount only when their flag is on, via injected adapters/renderers — never imported directly.

## 6. Reuse map (published vs new)

| Capability | Source | New work |
| --- | --- | --- |
| Timeline / stream render / smoothing | published primitives | wire only |
| Composer + draft | published | wire only |
| Streaming + replay + steer/stop/retry | published (transport/streamHub/chat-steer) | wire only |
| Local-tool pause/resume handoff | published (`localTools`, `localToolStreamSync`, parser) | wire only |
| Tool-call cards / generated-file cards | published `renderers/registry` defaults | wire + allow extra renderers |
| Attachment tray + lightbox + upload | **BR-38c** | dependency (consume its defaults) |
| Bubble/docked/inline layout | `stores/chatWidgetLayout` + `ChatWidget` shell | assemble `inline` layout |
| Comments / documents / drive / jobs / workspace RBAC | app-owned | expose as **optional** injected adapters/renderers (default off) |

## 6b. Theming & design-system — "adaptable AND exact" (BR-42 lineage)

Owner directive: in the **BR-42** app-foundry lineage, a sibling app must be able to take chat-ui **both ways at once**:

- **Exact (default)**: out of the box, `ChatConversation` renders the **exact sentropic theme 1:1** — a sibling app (drawing-skills, immo) gets the identical look with zero theming work. This is the literal "1:1" the requesters want.
- **Adaptable (opt-in)**: the same component is **re-themable through the design system** (`@sentropic/design-system` / sent-tech-design-system) — an app maps chat-ui to its own DS tokens without forking the component.

Mechanism (proposed): chat-ui consumes a **theme-token contract** (CSS custom properties / DS token set) injected by the host; it must **not hardcode** colours/spacing/typography. The DS owns the token vocabulary; chat-ui ships a **default token set = the sentropic theme**. So:

- `ChatConversation` gains a `theme?` slot (token set / DS preset). Default = sentropic.
- Apps pass their own DS preset to adapt; passing nothing keeps it exact.

**Font-scale nuance (owner)**: the current sentropic typography is **small**, so the sentropic default should be modelled as the DS **`size = "small"` preset**, not as an unscaled baseline. The DS density/type scale should treat sentropic-as-shipped = `small`, leaving `medium` / `large` presets available for apps that want larger type. This keeps "exact sentropic" and "DS-adaptable" the same axis (presets on one scale) rather than two competing theming systems.

This is a **BR-42-lineage** concern but is realised in the chat-ui turnkey surface (38c/38d): the `ChatConversation` theming surface must be **co-designed with the 42 / design-system track**, not bolted on later. → Coordinate with the DS agent (`codex:sent-tech-design-system` / `claude:sent-tech-design-system`); see active DS work `neg:ds-react-scaffolding` + airbus-theme-port. → **Decision D6 (§9).**

## 7. Scope & Non-Goals

In scope: the `ChatConversation` assembly, its feature-flag surface, package-default labels, unit tests (assembly projection + flag matrix), docs, and an example app-agnostic mount.

Non-Goals (unchanged from SDK scope study): no `@sentropic/llm-mesh` import; no provider/model/credential/persistence/route/runtime; no publishing of the app-coupled orchestration; no Chrome/VSCode runtime code. Comments/documents/drive/jobs/workspace stay app-owned and only enter via injected adapters/renderers.

## 8. Sequencing (proposed BR-38d lots)

- Lot 0 — Baseline & dependency gate: confirm BR-38c landed (attachment defaults present); map exact `AppChatPanel` behaviors → pure vs coupled.
- Lot 1 — `ChatConversation.svelte` turnkey core (timeline+composer+stream+steer/stop/retry+local-tools), package defaults, feature flags default-off; unit tests.
- Lot 2 — Attachment feature (consume BR-38c defaults) + optional adapter slots for comments/documents/jobs/workspace; flag-matrix tests.
- Lot 3 — App re-consumes `ChatConversation` in `AppChatPanel` (collapse duplication where 1:1), zero dual-path; E2E parity check; bump `@sentropic/chat-ui` minor.
- Lot N — Docs (update SDK scope study + this spec), publish, close negotiation (offer/sign).

## 9. Open decisions for the owner (batched — drive the counteroffer)

- **D1 — Lineage**: 38c → **38d** continuation (recommended) vs fold the dialogue assembly into 38c.
- **D2 — Implementer**: `38etc` continues into 38d after 38c, vs a separate session/agent owns 38d (I, `sentropic-chat`, remain study/coordination only).
- **D3 — drawing-skills 1:1 bar**: does "1:1" need bubble+docked+inline all three, or is `inline` enough for the mermaid editor's embed? (narrows Lot 1).
- **D4 — Attachments default**: BR-38d hard-depends on BR-38c, or ship `ChatConversation` with attachments behind a flag that no-ops until 38c lands (decouples timelines).
- **D5 — Counteroffer terms**: accept direction + 38d framing + post-38c sequencing (recommended), with a target `@sentropic/chat-ui` minor and an ETA tied to 38c merge.
- **D6 — Theming model (BR-42)**: adopt a DS token contract with sentropic-default = DS `size:"small"` preset (recommended), co-designed with the design-system track; vs ship exact-only now and add DS adaptability later. Confirm sentropic-as-shipped maps to `small`.

## 10. Pending inputs (do not counteroffer yet)

- **immo (radar-immobilier) request — AWAITED**: a second, related request is incoming per the owner; not yet in `sentropic-chat` inbox (verified — store has no radar-immobilier envelope). Hold the counteroffer until it lands so all asks (mermaid-editor + immo + theming) are harmonized in one response.
- **Owner sign-off** on D1–D6.

## 11. h2a negotiation status

`nego:chatui-turnkey-dialogue` — status `proposed`; `sentropic-chat` comprehension-attested (seq 1, non-binding). Next: after the immo request arrives and the owner signs off D1–D6, submit a **counteroffer** carrying this study's framing (turnkey `ChatConversation` via composition + BR-38c attachment defaults, 38c→38d lineage, DS-adaptable/exact theming), then sign once terms are agreed.
