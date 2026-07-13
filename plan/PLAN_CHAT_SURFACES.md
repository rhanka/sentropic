# PLAN — Chat surfaces implementation (L0→L5), delegation-optimized

Master plan turning `spec/SPEC_EVOL_CHAT_SURFACES.md` (D1–D13) into executable lots. **L1-core is SHIPPED** (`createPlacementController`, chat-ui 0.25.0). This plan maximizes delegation to **Sonnet** subagents: Opus keeps only the architectural/risky judgment + final adversarial review; everything with a stable contract + test-first DoD is Sonnet-delegable.

## Delegation principle
The controller (L1-core) is a **stable, framework-neutral contract** (`requestPlacement`, `PlacementSnapshot`, `HostSurfaces`, `CommitFn`). Every downstream lot builds against it. A lot is **Sonnet-delegable** when it is: (a) self-contained, (b) has exact file targets, (c) consumes only the stable contract (no new architecture), (d) has a test-first definition of done. A lot is **Opus-required** when it invents architecture, crosses lot boundaries, or is high-blast-radius refactor.

## Model tier per lot
| Lot | What | Tier | Why |
|-----|------|------|-----|
| **L0-design** | Session-runtime extraction blueprint (what hoists out of `AppChatPanel` 3477 l., ownership boundary, snapshot/resubscribe contract, idempotent tool-result keys) | **Opus** | Highest-blast-radius refactor design; invents the runtime-owner boundary. |
| **L0-exec** | Mechanically move controller/stream/drafts/attachments/pending-tool state per the L0-design blueprint | **Sonnet** (Opus review) | Mechanical once the blueprint is precise; guarded by "no behavior change" tests. |
| **L1c-migrate** | `chatWidgetLayout` + `ChatDock`: relabel `floating\|docked` → `floating.right` + `drawer.right.primary` against the controller; keep current behavior | **Sonnet** | Pure relabel of 2 existing modes, no remount, fully testable. |
| **L1c-menu** | "Move chat to…" keyboard-accessible menu calling `requestPlacement`; wire `HostSurfaces` + persistence adapter (D6 key `chat-ui/placement/v1/{userId}/{hostId}/{ws}`) | **Sonnet** | UI + adapter wiring against a done API; menu is standard. |
| **L2-gesture** | Web DnD gesture adapter (headless: pointer state, hit-testing, drop→`requestPlacement`); NO DS visuals | **Sonnet** | Pure logic module + unit tests; independent of AppChatPanel. |
| **L2-ds-consume** | Consume DS `Drawer`/`DropZone` (endorsed #32) once shipped; pass controlled props {width,collapsed,topology,ordering} | **Sonnet** (gated on DS #32 formal comment) | Prop wiring against DS + controller contracts. |
| **L3** | Add `floating.left` / `floating.center` / `full` placements + host container rendering | **Sonnet** | Mechanical taxonomy extension once L1c exists. |
| **L4** | vscode native mapping (`reparent:'command'`, VS Code commands, no DnD/floating/full) | **Sonnet** | Host-specific, well-scoped adapter. |
| **L5** | Smart stacked occupancy (D5 single-scroll-owner: split-primary/sticky-item, host occupancy snapshot, inert-on-collapse, virtualized anchor) | **Sonnet** (heavy Opus review) | D5 is very precisely spec'd (Codex+DS hardened) → executable; but subtle a11y/scroll → Opus reviews. |
| **integration + final review** | Cross-lot wiring decisions, adversarial review before each merge | **Opus** | Judgment + quality gate. |

## Dependency graph & waves
```
L1-core (DONE) ─┬─ L1c-migrate ───────────────┐
                ├─ L2-gesture (headless) ──────┤
                └─ L0-design (Opus) ─ L0-exec ─┼─ L1c-menu ─ L3 ─┐
                                               ├─ L4            ├─ L2-ds-consume (⟂ DS#32) ─ L5 ─ final
                                               └────────────────┘
```

- **Wave 1 (parallel Sonnet lanes, no L0 dependency)** — both only touch the stable controller, not the chat runtime:
  - `S1` L1c-migrate (relabel; behavior-preserving)
  - `S2` L2-gesture (headless DnD adapter + hit-testing)
  - `O0` L0-design (Opus, in parallel — produces the blueprint that unblocks Wave 2)
- **Wave 2 (after L0-exec merges)** — parallel Sonnet lanes:
  - `S3` L0-exec (Sonnet, Opus-reviewed) — must land first in this wave
  - then `S4` L1c-menu, `S5` L3 floating/full, `S6` L4 vscode (parallel)
- **Wave 3**:
  - `S7` L2-ds-consume (gated on DS #32 formal comment + published DS components)
  - `S8` L5 stacked occupancy (Opus-reviewed)
  - Opus final adversarial review + owner UAT before each user-visible merge.

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
