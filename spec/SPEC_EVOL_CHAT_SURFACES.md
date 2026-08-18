# SPEC_EVOL — Chat surfaces & placement (drawer / floating / DnD)

Status: EVOL (committed direction, numbered decisions D1–D13). Rung climbed from STUDY after Opus + Codex adversarial review (2026-07-11), owner batched decisions, and a Codex 5.5-**xhigh** hardening pass (verdict was *needs-revision* → this revision reconciles it). Cross-cutting with the design-system lane — DS-owned items flagged 🅳🅢 and gated on DS co-review (sent-tech-design-system#32) before implementation.

Owner (`sentropic-chat` lane) owns the chat-ui parts; the design system owns the canonical `Drawer`/`DropZone` visuals; each host owns its real surfaces.

---

## 1. Goal
A surface/placement model for `@sentropic/chat-ui` that lets the same chat live in, and move between, multiple placements — right/left drawer, floating (left/center/right), full — driven initially by the vscode plugin's drawer need, generalized as a design-system surface option. This spec adds the SURFACE layer above the chat content and, critically, extracts the chat SESSION RUNTIME so a placement change never restarts the conversation.

## 2. Locked decisions

- **D1 — Ownership split.** chat-ui ships a framework-neutral **placement-intent controller** (pure state machine + async transition protocol, D13). The **host** declares its surfaces, owns the real containers, and performs the physical re-parent/commit. The **design system** ships canonical `Drawer` + `DropZone` + drag-affordance visuals as OPTIONAL adapters. The controller MUST work against arbitrary host containers; the DS Drawer is one adapter, never a prerequisite.

- **D2 — Placement taxonomy (normalized).**
  ```ts
  type ChatPlacement =
    | { kind: 'drawer'; side: 'left' | 'right'; occupancy: 'primary' }
    | { kind: 'drawer'; side: 'left' | 'right'; occupancy: 'stacked'; stickiness: 'top' | 'bottom' }
    | { kind: 'floating'; anchor: 'left' | 'center' | 'right' }
    | { kind: 'full' };
  ```
  Every placement has a **canonical string ID** (e.g. `drawer.right.primary`, `drawer.right.stacked.bottom`, `floating.center`, `full`); the controller normalizes objects to IDs (no ambiguous defaulting — `stacked` always carries `stickiness`).
  Invariants that keep states orthogonal (must hold or the taxonomy collapses on small screens):
  - `floating.*` = **bounded, non-exclusive**, leaves host content visible.
  - `full` = **viewport-sized, exclusive** takeover.
  - `drawer.primary` = chat owns the drawer region. `drawer.stacked` = chat shares an occupied drawer; the concrete **stack topology** (`split-primary` vs `sticky-item`, per D5) is **host-resolved**, not a taxonomy axis — the host exposes it so the DOM/focus/scroll contract is unambiguous.
  - Open/closed is an **orthogonal surface-lifecycle** state, not a placement.

- **D3 — Host capability set (exact, not Cartesian).** Hosts declare the **exact set of supported placement IDs**, plus re-parent semantics — never a boolean product that implies all anchors/sides:
  ```ts
  type HostSurfaces = {
    supported: ChatPlacementId[];      // exact IDs this host can mount
    reparent: 'dom' | 'command';       // dom = web move (DnD viable); command = host API (vscode)
    fallbackChain: ChatPlacementId[];   // deterministic redirect order when a target is unavailable
  };
  ```
  Legal target set = declared `supported`. Examples: web app supports the full ID set with `reparent:'dom'`; vscode supports only `drawer.right.primary` (+ `drawer.right.stacked.bottom` once L5 ships) with `reparent:'command'`.

- **D4 — Repositioning: one intent API, two front-ends.**
  Universal path = **"Move chat to…" menu** (keyboard-accessible, every host; in vscode it maps to VS Code commands). Web sugar = **drag-n-drop** (`reparent:'dom'` hosts only), a grab handle whose drop calls the same intent API. DnD pointer/gesture state lives in a **web gesture ADAPTER**, not in the headless controller. DnD is silently absent where `reparent:'command'` — honest framing: a vscode webview cannot be dragged out of its native ViewContainer.

- **D5 — Smart occupancy (owner-confirmed intent; host-resolved topology + concrete impl contract).** When a `drawer.stacked` target is requested and the drawer is occupied:
  - **single existing item** → topology `split-primary`: the existing content is wrapped as a collapsible, independently-scrollable section; chat takes the primary region.
  - **multiple existing items** → topology `sticky-item`: chat becomes one item, sticky + collapsible, **bottom by default** (top optional). Both configurable per host/user.
  - Impl contract (non-negotiable to avoid the scroll/focus trap):
    - Occupancy is an **authoritative host snapshot with stable item IDs, excluding the moving chat** — NEVER inferred from DOM child count (nested drawers/portals/placeholders break it).
    - Occupancy may change between hover and drop → resolve+commit revalidate atomically on the same revision.
    - **Single scroll owner**: drawer root is non-scrolling; use fixed flex sizing + `min-height:0` + overscroll containment; the section wrapper is non-scrolling OR the child relinquishes its scroller (a virtualized child keeps its own).
    - A sticky panel reserves an inset equal to its collapsed/expanded footprint (no covering the other region).
    - Virtualized message-list scroll restore uses a **semantic anchor (message ID + pixel offset)**, remeasured after the drawer settles — never `scrollTop` alone across width/height change.
    - A `split-primary → sticky-item` transition (occupancy 1→N) must NOT remount chat or discard the virtualizer cache.
    - Mobile: `visualViewport` height changes from the keyboard use **hysteresis**; IME-only height changes are not a new placement constraint.
    - Collapsing a section makes descendants `inert`/unfocusable and restores focus predictably on expand.

- **D6 — Persistence & authority (explicit adapter, monotonic).** A host-injected persistence adapter (no implicit `localStorage`), namespaced and versioned:
  ```text
  key = chat-ui/placement/v1/{userId|'anon'}/{hostId}/{workspaceId|'global'}
  value = { schema: 1, requested: ChatPlacementId }
  ```
  `userId` MUST be in the key (no cross-account leak on a shared browser). Define: legacy `chatWidgetDisplayMode` migration, SSR (no-op read), malformed-value discard, logout cleanup, multi-tab update, anon↔auth separation. Authority: persist **user intent immediately**; the host resolves the **latest revision** to an effective placement; `effective` is transient/host-authoritative. Resolution is a **pure function of (intent, environment revision)** — NOT a render side-effect (avoids reactive loops). Environment recompute may change `effective` but must never overwrite a newer `requested`; late acks are `superseded`.

- **D7 — Session runtime lives ABOVE the surface (CORRECTED).** Today the chat controller is **component-local**: `const ctrl = createChatLoopController()` is constructed inside `AppChatPanel.svelte:352` (and `ChatConversation.svelte:218`); teardown detaches stream/tool machinery at `AppChatPanel.svelte:3097`; drafts/attachments/scroll/checkpoint prompts are component state. So a remount TODAY = new controller = detached stream, dropped attachments, possibly double- or zero-handled pending tool calls. Therefore D7 REQUIRES a **runtime-extraction lot (L0)**: hoist the session runtime (controller + stream subscription + drafts + attachments + pending tool state) to a **surface-independent owner**, and promise the **same LOGICAL session runtime** across a move — via snapshot + resubscription when a literal instance cannot survive (e.g. a destroyed VS Code webview/process). Tool results must be **idempotently keyed** so a re-attach never re-posts.

- **D8 — Accessibility (first-class).** Every DnD affordance has a keyboard equivalent (the menu). Transitions restore focus to the composer, announce the new placement (aria-live), respect `prefers-reduced-motion`, keep deterministic tab order; `drawer.stacked` collapse/expand is keyboard-operable with focus restoration (D5).

- **D9 — vscode mapping.** `reparent:'command'`: chat in a native ViewContainer; "Move to…" → VS Code commands. No DnD, no floating/full. Declares `supportsStackedDrawer` only from L5 onward (D12).

- **D10 — DS components (🅳🅢, DS co-review #32: ENDORSE-with-conditions, 2026-07-13).** `Drawer` (left|right, collapsible), `DropZone`, drag-affordance/grab-handle. Token-driven, theme-aware, density-aware ("petit"). The DS lane ran its own Opus+Codex-xhigh consensus, D13 cross-check PASSED; boundary confirmed unchanged (DS owns ONLY presentational visuals — zero placement gesture/state/occupancy/reparent). Folded L2-shaping conditions:
  1. Single-scroll-owner stacked section is a real DS primitive (non-scrolling root, `min-height:0` chain, overscroll-contain, sticky inset, inert-on-collapse) — but topology (`split-primary`/`sticky-item`), primary-vs-sticky, ordering, collapsed are **controlled PROPS the chat-ui controller computes** from the authoritative host occupancy snapshot; DS counts nothing (never DOM child count).
  2. Collapse = `hidden` + `inert`, **NEVER unmount** (`{#if}`) — the virtualized message list keeps its scroller/anchor across a 1→N move; a destroyed-webview remount rehydrates via the D7 snapshot/resubscribe.
  3. `width` + `collapsed` strictly **controlled** (`width`+`onResize`, `collapsed`+`onToggleCollapse`); no DS `localStorage` (D6 persistence stays chat-ui's). DS-local exception: a self-contained resize-width pointer handler (imperative CSS var during drag, `onResize` committed on pointerup) — outside D13 (resizing sizes a panel, never re-parents; effective width still round-trips through the host D6 adapter).
  4. Grab-handle = a focusable `<button>` **dual affordance**: drag-origin + Enter/Space opens the chat-ui "Move to…" menu (D4/D8); `DropZone` + handle forward their `ref` on all 4 framework ports.
  5. `DropZone` contract (valid/invalid, hit-tolerance units, visual language, "petit" geometry) is DEFINED in the DS, though hit-testing stays in chat-ui.
  DS co-review remains an **entry gate** for L2 (now cleared, pending the formal #32 comment).

- **D11 — Composition with existing components.** `ChatDock` consumes the placement controller (its `floating|docked` binary becomes `floating.right` + `drawer.right.primary`). `ChatPanelShell` unchanged. `chatWidgetLayout` store generalized from `DisplayMode` to `ChatPlacement` (+ legacy migration, D6).

- **D12 — Lot staging (design complete now; build ordered by dependency).**
  - **L0 — Session-runtime extraction** (prerequisite for any move that can remount; D7). No visible change; enables safe re-parent.
  - **L1 — Controller + capability negotiation + persistence/fallback + "Move to…" menu**; migrate `floating|docked` → include **`floating.right`** and `drawer.right.primary` explicitly.
  - **L2 — DS `Drawer`/`DropZone`** (entry gate: #32) + **left drawer** + **web DnD** (gesture adapter).
  - **L3 — `floating.left` + `floating.center` + `full`** (not "all floating"; L1 already owns `floating.right`).
  - **L4 — vscode native mapping** (`reparent:'command'`; declares NO stacked support until L5).
  - **L5 — smart stacked occupancy** (`split-primary` / `sticky-item`, D5); depends on the L2 Drawer section contract; only after this may any host advertise `supportsStackedDrawer`.

- **D13 — Atomic async placement-transition protocol (the load-bearing runtime rule).**
  > A move is a **versioned async prepare/commit transaction**. Valid user intent is persisted immediately. The host resolves and attempts the **latest** revision. `effective` changes **only after successful physical commit**. Redirects preserve the original `requested`. Failure leaves the previous `effective` active with a `reason`. Superseded acknowledgements are ignored. The **logical session runtime stays alive independently of surface instances**.
  This single rule resolves the controller ambiguity (§3), the D6 races, and D7 stream/tool safety.

## 3. Controller contract (headless, chat-ui)
```ts
type PlacementReason =
  | 'unsupported' | 'temporarily-unavailable' | 'occupied' | 'viewport'
  | 'host-failure' | 'superseded';

type PlacementSnapshot = {
  requested: ChatPlacement;           // persisted user intent
  effective: ChatPlacement;           // last successfully committed placement
  supported: ChatPlacement[];         // permanent host support
  available: ChatPlacement[];         // presently viable (supported ∧ environment)
  pending?: { id: number; target: ChatPlacement; resolvedTarget: ChatPlacement };
  lastResolution?: { status: 'applied' | 'redirected' | 'rejected' | 'failed' | 'superseded'; reason?: PlacementReason };
};

type PlacementResult = { status: PlacementSnapshot['lastResolution']['status']; placement: ChatPlacement; reason?: PlacementReason };

type PlacementController = {
  snapshot(): PlacementSnapshot;
  requestPlacement(target: ChatPlacement): Promise<PlacementResult>; // async: DOM one-frame, vscode multi-step
  subscribe(cb: (s: PlacementSnapshot) => void): () => void;          // returns unsubscribe
};
```
Pure, framework-neutral (no DOM, no Svelte). `supported` vs `available` are distinct (permanent vs temporary). DnD begin/hover/drop is NOT here — a web gesture adapter owns pointer state and calls `requestPlacement` on drop. `reparent` is adapter metadata, not part of the domain model.

## 4. Open items for design-system co-review (#32)
- Exact `Drawer` API (resize min/max, persisted width, the single-scroll-owner stacked-section contract from D5).
- `DropZone` visual language + drag-affordance placement on the chat header.
- Token/density mapping ("petit").
- Ownership boundary: DS static components vs chat-ui-driven gesture.

## 5. Non-goals / deferred
- Multiple simultaneous docked chats.
- Cross-device layout sync.
- Native DnD in vscode (platform can't).

## 6. Peer review trail
- **Opus 4.8** (design lead) + **Codex 5.5-high** (round 1) + **Codex 5.5-xhigh** (round 2, hardening).
- Round 1 reconciled: DnD not cross-host → intent API substrate (D4); stacked-sticky trap unless single-scroll-owner → D5; missing authority → D6; state-above-surface → D7; a11y first-class → D8.
- Round 2 (xhigh, verdict *needs-revision*, reconciled into THIS revision): added the async prepare/commit protocol (D13); enriched the controller contract (pending/reason-codes/supported-vs-available/unsubscribe/Promise, DnD out of core) §3; normalized the taxonomy (host-resolved stack topology, floating/full invariants, exact host-supported IDs) D2/D3; **corrected D7** (controller is component-local today → runtime-extraction lot L0 required); explicit persistence adapter + monotonic revisions D6; D5 concrete impl contract; fixed lot ordering (L0 first, `floating.right` in L1, vscode no-stacked-before-L5, DS review = entry gate) D12.
- **DS lane co-review (sent-tech-design-system#32, 2026-07-13): ENDORSE-with-conditions** — own Opus+Codex-xhigh consensus, D13 cross-check PASSED, boundary confirmed, 5 conditions folded into D10. L2 gate cleared (pending formal #32 comment).
- Owner ratifications: full taxonomy up front + DS co-review gate; D5 occupancy design confirmed.
