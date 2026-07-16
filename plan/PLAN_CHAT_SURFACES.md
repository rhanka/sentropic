# PLAN — Chat surfaces implementation (L0→L5), delegation-optimized

Master plan turning `spec/SPEC_EVOL_CHAT_SURFACES.md` (D1–D13) into executable lots. **L1-core is SHIPPED** (`createPlacementController`, chat-ui 0.25.0). This plan maximizes delegation to **Sonnet** subagents: Opus keeps only the architectural/risky judgment + final adversarial review; everything with a stable contract + test-first DoD is Sonnet-delegable.

## Delegation principle
The controller (L1-core) is a **stable, framework-neutral contract** (`requestPlacement`, `PlacementSnapshot`, `HostSurfaces`, `CommitFn`). Every downstream lot builds against it. A lot is **Sonnet-delegable** when it is: (a) self-contained, (b) has exact file targets, (c) consumes only the stable contract (no new architecture), (d) has a test-first definition of done. A lot is **Opus-required** when it invents architecture, crosses lot boundaries, or is high-blast-radius refactor.

## Model tier per lot
| Lot | What | Tier | Why |
|-----|------|------|-----|
| **L0-design** | Session-runtime extraction blueprint (what hoists out of `AppChatPanel` 3477 l., ownership boundary, snapshot/resubscribe contract, idempotent tool-result keys) | **Opus** | Highest-blast-radius refactor design; invents the runtime-owner boundary. |
| **L0a** | Runtime state + attachGeneration-idempotent lifecycle + cursor/snapshot contract + tests | **Opus / luna-xhigh** | Subtle lifecycle correctness (per Codex-xhigh review). |
| **L0b+L0c** | ONE guarded cutover: move stream/tool/draft/checkpoint ownership into the runtime, rewire view to snapshot/command, delete dual path | **Luna / Opus** | NOT Sonnet — reactive coupling, hydration races, source-of-truth deletion (review re-tiered). |
| **L0d** | Cross-process serialize/restore + cursor replay + tool-result idempotency | **Opus/Luna, BLOCKED** | Needs a NEW backend contract (server-enforced tool-result idempotency on `POST /tool-results` + durable stream replay) — api/** lane, not chat-ui. |
| **L1c-migrate** | `chatWidgetLayout` + `ChatDock`: relabel `floating\|docked` → `floating.right` + `drawer.right.primary` against the controller; keep current behavior | **Sonnet** | Pure relabel of 2 existing modes, no remount, fully testable. |
| **L1c-menu** | "Move chat to…" keyboard-accessible menu calling `requestPlacement`; wire `HostSurfaces` + persistence adapter (D6 key `chat-ui/placement/v1/{userId}/{hostId}/{ws}`) | **Sonnet** | UI + adapter wiring against a done API; menu is standard. |
| **L2-gesture** | Web DnD gesture adapter (headless: pointer state, hit-testing, drop→`requestPlacement`); NO DS visuals | **Sonnet** | Pure logic module + unit tests; independent of AppChatPanel. |
| **L2-ds-consume** | Consume DS `Drawer`/`DropZone` (endorsed #32) once shipped; pass controlled props {width,collapsed,topology,ordering} | **Sonnet** (gated on DS #32 formal comment) | Prop wiring against DS + controller contracts. |
| **L3** | Add `floating.left` / `floating.center` / `full` placements + host container rendering | **Sonnet** | Mechanical taxonomy extension once L1c exists. |
| **L4** | vscode native mapping (`reparent:'command'`, VS Code commands, no DnD/floating/full) | **Sonnet** | Host-specific, well-scoped adapter. |
| **L5** | Smart stacked occupancy (D5 single-scroll-owner: split-primary/sticky-item, host occupancy snapshot, inert-on-collapse, virtualized anchor) | **Sonnet** (heavy Opus review) | D5 is very precisely spec'd (Codex+DS hardened) → executable; but subtle a11y/scroll → Opus reviews. |
| **integration + final review** | Cross-lot wiring decisions, adversarial review before each merge | **Opus** | Judgment + quality gate. |

## L0 is NOT a blanket prerequisite — verified in code (2026-07-13)
The plan originally gated L1c-menu/L3/L4 behind L0-exec, on the assumption that any placement move remounts the view (= session restart). **Verified against the real code — that assumption is only true for a subset:**
- `packages/chat-ui/src/components/ChatDock.svelte:500-521` renders the dialog as **ONE stable `<div>`**; `docked` vs `floating` is a **`class=`/`style=` ternary on `_isDocked` (l.508-513)**, NOT an `{#if}` branch. `renderContent` is a snippet rendered inside that stable container. The only `{#if !_isDocked}` (l.483) wraps the mobile backdrop alone.
- `ChatWidget.svelte:36` `{#if renderShell}` tests snippet existence — it is not placement-dependent.
- `ui/src/lib/components/ChatPanel.svelte:41` mounts `<AppChatPanel` with **no `{#if}`/`{#key}` guard**.
→ **Today's docked↔floating switch already does NOT remount.** Placement is expressed as CSS on a stable container.

**Consequence (drives the wave order):**
- **No L0 needed** for placements expressible as a class/style swap on that same stable container: `floating.left|center|right`, `full`, `drawer.right.primary`. Host invariant: keep ONE container, swap classes — never branch the container behind `{#if}`.
- **L0 required** only where the placement needs a genuinely DIFFERENT DOM parent owned by the host, outside ChatDock's subtree: **left-drawer**, **L4 vscode drawer**, **L5 stacked occupancy**. L0d (cross-process) additionally needs the backend contract.

## Dependency graph & waves (revised)
```
L1-core (DONE) ─┬─ L1c-migrate (DONE 0.26.0) ──┐
                ├─ L2-gesture  (DONE 0.26.0) ──┤
                ├─ L1c-menu ── L3 floating.left/center + full ──┐   (NO L0 — class-swap)
                └─ L0a ─ L0b+L0c (one guarded cutover) ─┬─ left-drawer ─ L5 stacked ─┐
                                                        └─ L0d (⟂ backend) ─ L4 vscode ─┴─ L2-ds-consume (⟂ DS#32) ─ final
```

- **Wave 1 — DONE (chat-ui 0.26.0, PR #418 merged + published)**: `S1` L1c-migrate + `S2` L2-gesture (2 parallel Sonnet lanes, Opus-reviewed, 871 tests green); `O0` L0-design (Opus + Codex-xhigh review, reconciled).
- **Wave 2 (parallel Sonnet lanes, NO L0 dependency — per the code-verified finding above)**:
  - `S3` L1c-menu ("Move to…" menu + HostSurfaces + D6 persistence adapter)
  - `S4` L3 `floating.left|center` + `full` (class-swap placements on the stable container)
  - Host invariant both lanes MUST honor: ONE stable container, class/style swap only — never branch it behind `{#if}` (that would reintroduce the remount L0 exists to prevent).
- **Wave 3 (L0 track, Luna/Opus — runs in parallel with Wave 2, different files)**: `L0a` then the `L0b+L0c` guarded cutover. Unblocks left-drawer, L5, and (with the backend contract) L0d→L4.
- **Wave 4**: `L4` vscode (needs L0d + backend), `L5` stacked occupancy, `L2-ds-consume` (gated on DS #32 formal comment). Opus final adversarial review + owner UAT before each user-visible merge.

Wave discipline: ≤4 concurrent lanes; each lane = its own branch/worktree + distinct ENV/ports; each lane commits atomically, gates green, PR, CI, Opus review, merge. Sonnet lanes get the `AGENT_SIG:7f3a9c2e1b` launch template + exact BRANCH.md scope.

## Per-lane launch contract (for Sonnet subagents)
Each lane's launch packet MUST include: the stable contract snippet (`createPlacementController` API from chat-ui 0.25.0), exact Allowed/Forbidden paths, the test-first file list (write tests first, then code), the gate command (`make typecheck-chat-ui` + `make test-chat-ui` [+ `-dom`] ENV=<lane>), commit discipline (make commit, selective add, <150 lines), and "escalate to Opus on any architectural fork — do not invent." Framework-neutral rule: zero Svelte/DOM in `state/*` modules.

## Model routing (owner-ratified 2026-07-13)
- **Build (normal lots)**: Sonnet or Codex 5.3-xhigh.
- **Hard build**: Codex 5.6-luna-xhigh.
- **Design**: Codex 5.6-tera-xhigh + **Opus 4.8-xhigh review**.
- **Final adversarial review**: Opus 4.8-xhigh (+ Codex-xhigh second peer).
- The "Tier" column above maps: Sonnet-delegable → Sonnet/Codex-5.3; Opus-required design → tera-xhigh draft + Opus review; L5/L0-exec hard slices may escalate to luna-xhigh.

## Ratification — DONE (owner 2026-07-13): launch Wave 1 complete in parallel.
- **S1** L1c-migrate → Sonnet lane. **S2** L2-gesture → Sonnet lane. **O0** L0-design → Opus draft + Codex-xhigh review.
