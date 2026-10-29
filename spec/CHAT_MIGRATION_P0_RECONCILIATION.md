# P0 — Specification and UAT reconciliation

Effective migration interpretation: 2026-10-28, against `ea20bd9c026e9717d911514e763f8911b6981dde`. [Contract](CHAT_MIGRATION_P0.md). The five earlier documents retain their historical wording. This crosswalk resolves their dated claims for the approved migration; it does not mark their entire backlogs complete or rewrite DS-owned normative material.

## Five-source crosswalk

| Source / clauses | Verified state or conflict | P0 disposition / accountable role |
| --- | --- | --- |
| `spec/SPEC_EVOL_CHAT_ECOSYSTEM.md` §§2–3, 7.2, 8 | Describes a nonbreaking headless UI core and framework binding extraction; the `chat-ui-core` proposal #213 closed without merge. Current package is `chat-ui@0.34.1`, not a completed separate core. | Do not restart or credit abandoned extraction. New **Sentropic runtime** separation is P1, distinct from visual core abstraction; optional framework bindings stay follow-ons. Runtime/visual owners qualify public contracts without private source links. |
| ECOSYSTEM §2.1/nonbreaking and §7.2 retrofit | Historical nonbreaking expectation conflicts with P1 removal of existing runtime exports. | Approved P1 explicitly requires a breaking release/import migration **before U0**, with notices and packed candidates for every consumer. M1–M4 preserve that resulting visual contract; repository custody alone does not force another major. L-A′ rename remains separate. |
| ECOSYSTEM §3 sameness, §3.1/T2 | Theme seam exists, but app remains Tailwind source-scan Mode A with inherited overrides. | P3 switches the actual app to scoped token stylesheet Mode B; remove package-source scanning/competing chat overrides. DS owns vocabulary; host owns preference persistence. A shipped stylesheet is not completed adoption. |
| ECOSYSTEM §8 no orphan/duplicate gates | Export presence or 21/24 render-component wiring does not equal migration completion (report: 23.5/38 historical lots). | P0 behavior matrix + P5 installed-consumer/parity evidence replace percentage inference. Valid alternative exports such as ContextChips/SessionList need not all be mounted in the same app. |
| `spec/SPEC_EVOL_CHATUI_TURNKEY_DIALOGUE.md` status, §§2, 4, 6, 8 | Still STUDY, cites 0.1.2 and missing ChatConversation/ongoing 38c. Current Conversation and attachment primitives exist; current Conversation is incomplete, app still assembles dialogue. | Continue 38d on shipped 38c. P1 completes parity/separates runtime; P2 performs Lot 3 adoption. Do not re-run completed attachment extraction or preserve stub methods as a valid minimal turnkey contract. |
| TURNKEY §5 host-driven internal runtime wiring | Proposed component internally wires stream/projection/tool loop; DS contract excludes that implementation. | P1 gives view normalized snapshots/commands from host-owned Sentropic runtime; transport/stream/local-tools move to `chat-runtime`. Optional host adapters remain optional; no workspace/auth/comments/jobs dependency for standalone dialogue. |
| TURNKEY §6b exact/adaptable and D6 | Exact default is a small-density DS preset, not a separate literal app skin. Historical v1 THEMING limitations are partly stale because DS now ships control hover/disabled tokens. | P3 uses qualified theme/token/density and one color-mode route. Preserve supported app appearance/behavior while enabling alternative presets through the same components. |
| `spec/SPEC_EVOL_CHAT_SURFACES.md` D1–D6, D8–D13 | Placement-intent/controller, host physical commit/occupancy/storage and DS visual responsibilities are distinct. Stable-container menu/DnD/class swaps already exist. | Retain pure reusable placement/layout/gesture views; host owns authorized containers, occupancy revision, native commands and persistence. P2 preserves D13 latest-intent/commit semantics and semantic focus/scroll restore. No native-surface feature expansion in P0. |
| SURFACES D7 and L0 | Runtime files exist, but app/Conversation construct component-local controllers; a remount can detach stream/tool state. | P1 relocates runtime; P2 is one guarded L0b+L0c cutover above surfaces. No completed-runtime claim from file existence. Cross-process L0d remains F8, new native mapping L4 F9. |
| SURFACES D10 / DS #32 and `plan/PLAN_CHAT_SURFACES.md` L2-ds-consume | Drawer source/export exists; actual 0.36.0 tarball lacks required persistent collapse/controlled API. DropZone absent. | P4 consumes only a future qualified Drawer slice. DS owns its concrete API gap. F15 owns missing DropZone; existing ChatPlacementDropZones stays canonical. #32 endorsement is not a published-artifact guarantee. |
| PLAN_CHAT_SURFACES waves/dependencies | Historical waves say L0 is not a blanket prerequisite; stable-container class swaps do not require runtime extraction. | Preserve completed L1/L2-gesture/L3 work and avoid making it newly dependent on L0. This migration's remount-safe app cutover still requires P1/P2. L5 stacked occupancy stays F10; AppShell is an L-F gate, not a core transfer gate. |
| `spec/SPEC_EVOL_AGENTS_SURFACE.md` §3, D1c, L-C-shell | Older account says app takes over shell; #602 removed Widget takeover and added package header/tab bar/gate/pager. A 767-line actions snippet remains app-local. | Preserve #602's delivered shell routing; P2b finishes reusable header/control handover using the complete snippet map. No second shell/tab bar/scroll owner. |
| AGENTS D1/D1a/D1b/L-A′ | Public tab union rename already has 2026-07-29 breaking GO; remains separate from runtime break. | F1 after header handover, existing plugin maintainers + explicit cowork hand-over; no new request for the same GO. P0 does not rename tabs. |
| AGENTS D6/D13, jobs, O1 | Per-device consultation markers, navigation selection, runtime session selection and job projection are separate state. | Markers persist in Sentropic runtime/host; visual sorting/view intents remain reusable. Preserve pending-first order and job actions/no duplicate chat-message rows. Do not let a live session force the visible entry after Back. |
| AGENTS L-D and §8 scope UI | Older spec allows disabled toggle with developer explanation; UAT-1 explicitly forbids API/developer justification in product UI. | Later owner UAT rule takes precedence: bounded own-principal all-workspace endpoint/toggle works, or hide unavailable toggle. F1 architect concurrence is recorded; no speculative API widening. |
| AGENTS O2–O7 and D21 | Old recommendations are not all ratifications; transcript ordering is not egress authorization. | Apply bounded §6 defaults in the defaults appendix; O2 remains proposal, O3 own-principal interim, D21 architect + owner. No cross-principal visibility or foreign transcript export in migration. |
| AGENTS D22 optional DS peer | Historical optional peer was scoped to agents subpath; future Conversation composes DS primitives. | P1/M1b release owner rechecks entrypoint dependency metadata; cannot promise optional DS when imported visual entrypoints require it. Standalone dialogue still does not require AppShell. |

## Turnkey D1–D6 final disposition

| Decision | Migration contract |
| --- | --- |
| D1 lineage | 38c shipped → 38d continuation; no attachment restart. |
| D2 implementer | Current app/chat integration lead plus UI/runtime maintainer, not historical session identity. |
| D3 1:1 | Preserve supported floating/bubble, docked and inline; no inline-only scope reduction. |
| D4 attachments | Consume shipped tray/lightbox/upload for matching capability; preserve existing host attachments. |
| D5 terms | Parity-complete adoption before transfer; runtime-import break explicitly versioned; same candidate pair across siblings; lot scope, order and dependencies in the contract. |
| D6 theme | One DS token/preset axis, Sentropic small density; other presets use the same components. |

## #602 and owner UAT entry

PR [#602](https://github.com/rhanka/sentropic/pull/602), merged 2026-09-24 at `c26f0d2c0ee593ba39cd70e2d7edd72b89204392`, is delivered shell substitution, not completed personal UAT. Its reported unit/DOM qualification is historical evidence only. Preserve the three still-unchecked owner boxes verbatim in U0:

- [ ] UAT web: floating/docked/fullscreen geometry, mobile burger, list/conversation/Back/focus, all-workspaces, jobs/comments and settings overflow.
- [ ] UAT Chrome: overlay/sidepanel, comments suppression, auth/settings, single composer.
- [ ] UAT VSCode: loading/auth/onboarding actions and theme parity.

Present `spec/UAT1_FINDINGS_AGENTS_SURFACE.md` F1–F11 and its architect F1/F8 conclusions before the next UAT. That earlier verdict was nonblocking findings for the next step, not transfer GO. P0 records source evidence below; **P5** must bind each finding to its fixing PR/main SHA and technical tests before the owner sees U0. None of these rows closes personal UAT.

| Finding | Required behavior / current source evidence to qualify | Owner and evidence still required |
| --- | --- | --- |
| F1 | Working own-principal bounded all-workspaces list; no developer/API message. Widget `loadAgentsSessions` calls `/chat/sessions?scope=all`; Toggle wired. | APP/DATA: P5 verify server default bound/auth, fixing PR/SHA and actual toggle; architect's 2026-08-01 additive endpoint concurrence remains source authority. |
| F2 | New-session `+` DS IconButton with hover title; Widget `renderAgentsListHeaderHost` has IconButton. | UI/APP: P5 rendered title/action and fixing PR/SHA. |
| F3 | Human translated job name; jobs are projected by `agents-feed-adapter.ts`. | APP: P5 actual label translation and fixing PR/SHA; source projection alone does not close it. |
| F4 | Opaque menu above content, smaller text; package AgentsList uses DS controls. | UI/DS: P5 browser stacking/typography and fixing PR/SHA. |
| F5 | Typed conversation/job icon on first line, no initials substitution. | UI: P5 row DOM/layout and fixing PR/SHA. |
| F6 | Scope header fixed outside scrolling list. | UI/APP: P5 package pager/header browser scroll and fixing PR/SHA. |
| F7 | Conversation remains resumable; avoid misleading inactive/finished semantics. | UI/APP: P5 session-kind statuses/resume and fixing PR/SHA. |
| F8 | Known workspace supplied client-side. Adapter sets `workspaceLabel` from per-ID map/current label; Widget provides them. | APP: P5 rendered label and fixing PR/SHA; architect confirmed client-only, no API gap. |
| F9 | Connection only for remote rows; AgentsList has `kind === 'remote'` guard. | UI: P5 session/job/remote rows and fixing PR/SHA. |
| F10 | Back is icon-only DS button with title; package sessions header receives `backLabel`. | UI/APP: P5 icon/title/focus and fixing PR/SHA. |
| F11 | Relative time abbreviated, xs/muted. | UI/APP: P5 formatter/locales/typography and fixing PR/SHA. |

U0 additionally covers full payload/attachments, retry/stop/edit/feedback/steer, denied local tool, remount during stream and light/dark/auto against OS disagreement, Drawer collapse/focus and the exact installed package pair. Preprod login must work first; record web main SHA, package versions/digests, plugin build hashes and the owner's two distinct actual answers through Track CLI. A changed candidate repeats affected checks; no inferred GO.
