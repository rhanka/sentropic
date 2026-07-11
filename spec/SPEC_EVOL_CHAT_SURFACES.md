# SPEC_EVOL — Chat surfaces & placement (drawer / floating / DnD)

Status: EVOL (committed direction, numbered decisions D1–D12). Rung climbed from STUDY after Opus+Codex adversarial review (2026-07-11) and owner batched decisions. Cross-cutting with the design-system lane — DS-owned items flagged 🅳🅢 and gated on DS co-review before implementation.

Owner (`sentropic-chat` lane) owns the chat-ui parts; the design system owns the canonical `Drawer`/`DropZone` visuals; each host owns its real surfaces.

---

## 1. Goal
A surface/placement model for `@sentropic/chat-ui` that lets the same chat live in, and move between, multiple placements — right/left drawer, floating (left/center/right), full — driven initially by the vscode plugin's drawer need, generalized as a design-system surface option. The chat CONTENT (`ChatPanelShell`) is already placement-agnostic; this spec adds the SURFACE layer above it.

## 2. Locked decisions

- **D1 — Ownership split.** chat-ui ships a framework-neutral **placement-intent controller** (state machine: requested intent, available placements, effective placement, transition requests). The **host** declares its surfaces and owns the real containers + performs re-parent. The **design system** ships canonical `Drawer` + `DropZone` + drag-affordance visuals as OPTIONAL adapters (a host with its own drawer primitive may skip them). The controller MUST work against arbitrary host containers; the DS Drawer is one adapter, never a prerequisite. Mirrors the existing `ChatPanelShell` host-injection model.

- **D2 — Placement taxonomy (full, ratified up front per owner).**
  ```ts
  type ChatPlacement =
    | { kind: 'drawer'; side: 'left' | 'right'; occupancy: 'primary' | 'stacked'; stickiness?: 'top' | 'bottom' }
    | { kind: 'floating'; anchor: 'left' | 'center' | 'right' }
    | { kind: 'full' };
  ```
  `drawer.primary` = chat owns the drawer (generalizes today's `docked`, now left|right). `drawer.stacked` = shares an occupied drawer (see D5). `floating.{left,center,right}` = detached window layer. `full` = full-viewport takeover.

- **D3 — Host capability set (load-bearing).** Available placements are host-DECLARED, not universal:
  ```ts
  type HostSurfaces = {
    drawers: Array<'left' | 'right'>;
    floating: boolean;
    full: boolean;
    reparent: 'dom' | 'command'; // dom = web DnD possible; command = host API only (vscode)
    supportsStackedDrawer: boolean; // D5 opt-in
  };
  ```
  The set of legal placements = taxonomy ∩ HostSurfaces. Examples: web app `{ drawers:['left','right'], floating:true, full:true, reparent:'dom', supportsStackedDrawer:true }`; vscode `{ drawers:['right'], floating:false, full:false, reparent:'command', supportsStackedDrawer:true }`.

- **D4 — Repositioning: intent API + universal "Move to…" menu + web-only DnD (v1).**
  All movement goes through one API: `requestPlacement(target): 'accepted' | 'rejected' | { redirectedTo }`. Two front-ends over it:
  1. **"Move chat to…" menu** — keyboard-accessible, present on every host (works in vscode via host command). This is the universal path.
  2. **Drag-n-drop** — v1, **web-only** (hosts with `reparent:'dom'`), a grab handle on the chat header that ends by calling `requestPlacement`. It is UI sugar over the same API, NOT a separate mechanism, and is silently absent where `reparent:'command'`. Honest framing: DnD is not cross-host; a vscode webview cannot be dragged out of its native ViewContainer.

- **D5 — Smart occupancy fallback (owner design; satisfies single-scroll-owner discipline).** When the target drawer is occupied:
  - **Drawer holds a single content item** → chat coexists: the pre-existing content is wrapped as a **collapsible + independently-scrollable** section, and the chat takes the primary region. One scroll owner per region — no nested-scroll trap.
  - **Drawer already holds multiple items** → chat becomes **one of the items**, rendered as a **sticky, collapsible** panel, **bottom by default** (to visually differentiate it) or top.
  - Both behaviors are **configurable** (per host/user). `drawer.stacked` requires `HostSurfaces.supportsStackedDrawer`; otherwise the effective placement redirects (D6).

- **D6 — Authority & persistence.** Persist the **user INTENT** per host + workspace. The host computes the **effective** placement (accept / redirect / reject) each render; effective placement is transient and host-authoritative. On conflict (viewport too small, drawer removed, capability changed) the controller records the redirect and surfaces it; it never forces an unsupported placement. Deterministic fallback chain, host-declared, e.g. `drawer.stacked → drawer.primary → floating.right → full`.

- **D7 — State lives ABOVE the surface (anti-restart).** Conversation, drafts, focus, streaming subscription, scroll position, attachments, and pending tool interactions MUST survive a re-parent/remount. The chat session controller + `ChatPanelShell` state already decouple content from surface; the surface layer must re-mount the SAME controller instance/state, never re-create it. "Move chat" must never become "restart chat".

- **D8 — Accessibility (first-class, not a v2 patch).** Every DnD affordance has a keyboard equivalent (the "Move to…" menu). Placement transitions restore focus into the chat composer, announce the new placement (aria-live), respect `prefers-reduced-motion`, and keep deterministic tab order. `drawer.stacked` collapse/expand is keyboard-operable with focus restoration.

- **D9 — vscode mapping.** vscode uses `reparent:'command'`: chat lives in a native ViewContainer (drawer); the "Move to…" menu maps to VS Code commands (open/focus/move view). No DnD, no floating/full in v1 (`{ floating:false, full:false }`). Honest to the platform; parity via the menu, not fake drag.

- **D10 — DS components (🅳🅢, gated on DS co-review).** The design system provides: `Drawer` (left|right, resizable, collapsible, single-scroll-owner sections for stacking), `DropZone` (highlight + hit-target during a placement gesture), and a drag-affordance/grab-handle. These are the visual substrate reused by the web app, vscode webview fallback, and future hosts. Token-driven, theme-aware, density-aware (ties to the "petit" preset). **Ownership + exact API to be co-designed with the design-system lane before implementation.**

- **D11 — Composition with existing components.** `ChatDock` is refactored to consume the placement controller instead of its `floating|docked` binary (that binary becomes two points in the taxonomy: `floating.right`-ish + `drawer.right.primary`). `ChatPanelShell` unchanged (already placement-agnostic). `chatWidgetLayout` store generalized from `DisplayMode` to `ChatPlacement`.

- **D12 — Scope staging (design complete now, build staged).** Full taxonomy is SPEC'd here up front (owner). Implementation lots are staged so we never ship an unproven surface: (L1) controller + capability negotiation + persistence/fallback + "Move to…" menu + generalize docked→drawer(right); (L2) DS Drawer/DropZone + left drawer + web DnD; (L3) floating.{left,center,right} + full; (L4) vscode native mapping; (L5) smart stacked occupancy. Each lot adds a taxonomy member only when a real host consumes it.

## 3. Controller contract (headless, chat-ui)
```ts
type PlacementController = {
  requested: ChatPlacement;              // user intent (persisted)
  effective: ChatPlacement;              // host-authoritative (transient)
  available: ChatPlacement[];            // taxonomy ∩ HostSurfaces
  requestPlacement(target: ChatPlacement): 'accepted' | 'rejected' | { redirectedTo: ChatPlacement };
  onEffectiveChange(cb: (p: ChatPlacement) => void): void;
  // DnD sugar (web hosts only): begin/hover/drop map to requestPlacement.
};
```
No DOM, no Svelte imports (framework-neutral, React/Angular/Vue-ready like the rest of chat-ui state).

## 4. Open items for design-system co-review
- Exact `Drawer` API (resize, min/max, persisted width, stacked-section contract with single scroll owner).
- `DropZone` visual language (highlight, valid/invalid, hit tolerance) + drag-affordance placement on the chat header.
- Token/density mapping (the "petit" preset) for drawer chrome.
- Whether DS owns the drag controller visuals or only static components (chat-ui drives the gesture).

## 5. Non-goals / deferred
- Multiple simultaneous docked chats.
- Cross-device layout sync.
- Native DnD in vscode (platform can't).

## 6. Peer review trail
- Opus 4.8 (design lead) + Codex 5.5-high (adversarial). Reconciled: DnD is not cross-host → intent API is the substrate (D4); stacked-sticky is a scroll/a11y trap UNLESS single-scroll-owner → owner's D5 design satisfies this; missing authority decision → D6; state-above-surface → D7; a11y first-class → D8. Owner overrode "MVP staged only" → full taxonomy spec'd now (D2/D12) with DS co-review gate (D10).
