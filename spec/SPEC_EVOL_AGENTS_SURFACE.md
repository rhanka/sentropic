# SPEC_EVOL — Agents Surface (`agents | chats | comments`)

Status: **SEDIMENTED INTENTION — decisions D1–D14 drafted, O1–O5 open for owner, awaiting double adversarial review.**
Owner lane: `sentropic-chat` (chat ecosystem). Cross-lane dependencies declared in §6 — this lane does NOT own them.
Baseline: `main` @ `f8dea9af9` (`@sentropic/chat-ui@0.29.0`, placement system L1c+L2 merged in #429).
Source: owner utterance 2026-07-29 (FR), recorded as the requirement set R1–R11 below. §1 is a faithful restatement, not an interpretation; every design addition of mine is marked **[lane]** and lives in §4–§5.
Relates to: `SPEC_EVOL_CHAT_ECOSYSTEM.md` (WP-CHAT program); the placement decisions D1–D13 (shipped through L2 in **PR #429**, merge `4a17ca211`) — their spec was consolidated-and-deleted per the MASTER rule, so the merged code + PR are the reference, **not** a `spec/` file; `SPEC_EVOL_RESOURCE_FS.md` (RF10/RF11 — tool & terminal rendering, see D15); `SPEC_STUDY_39_MCP_AUTHKIT_ELICITATION_GAPS.md` (D18); `SPEC_EVOL_H2A_ROLES_SCOPES.md` (perennial roles), BR-58 `SPEC_EVOL_H2A_CHAT`, BR-70/71 Resource Plane (`/agents` mount), BR-39l (h2a sessions in the web app).

---

## 1. Intention (sedimented, owner-stated)

| # | Requirement |
|---|---|
| **R1** | The `chat` tab is renamed **`agents`**. New tab order: **`agents`, `chats`, `comments`**. |
| **R2** | Inside `agents`, **ad-hoc sessions** are separated from **perennial agents** — agents holding a durable role in the workspace. Already the case for code workspaces, and to be the case elsewhere too. Perennial agents exist only *when there are any*. |
| **R3** | A perennial agent **accumulates history** and MAY own **several sessions**. The ergonomics for browsing that history is **to be defined**. |
| **R4** | **Remote-control sessions** also appear in `agents`. |
| **R5** | **Jobs** are absorbed into `agents` **as sessions**. |
| **R6** | `chats` becomes an **inter-user chat**, in which perennial AI agents can intervene as participants. |
| **R7** | `comments` is kept as-is (it is artifact/document follow-up, not conversation). |
| **R8** | Switching to a tab shows, **by default, the list of conversations as items**, with per-item running status like Claude remote: a **status wheel spins while the item runs**, and when a **question/answer is pending** a **special tag** appears — respecting design-system colors. |
| **R9** | Ordering: **running** agents/sessions/jobs at the top; **perennial agents** next; then the **other sessions by age of last consultation**. |
| **R10** | A **menu** switches the browsing scope: **all workspaces** when checked, otherwise **restricted to the current workspace**. |
| **R12** | The surface must be able to **display the conversations of CLI agents** — `claude`, `codex`, `agy`, `openrouter`, `hermes` — the way Claude remote control does. |
| **R13** | The conversation restitution must therefore plan for the **display of tools, including terminals**. |
| **R14** | The **question/answer** affordance already exists but needs improving: it only offered **yes/no**. |
| **R15** | The restitution must also plan for **background tasks** and **delegated runs (subagents)**. |
| **R11** | In **full-screen**, the tab menu (`agents`/`chats`/`comments`) moves to the **left**, and the session list is a **side column — left or right, at the user's choice, repositionable** — carrying the same information as the reference screenshot: kind icon, name, elapsed time, connection status, workspace/repo, and a pending-question excerpt. |

Reference screenshots supplied by the owner: current session dropdown (flat `Conversation <hash>` list), Claude-remote item list (icon + name + elapsed + `Connecté • rhanka/<repo>`, and an inline `decide: …` card for a pending question, with an unread dot).

---

## 2. Target taxonomy **[lane]**

One union type, because R9's ordering crosses kinds (a running *job* outranks an idle *perennial agent*):

```ts
type AgentsEntryKind =
  | 'agent'    // perennial: durable role in a workspace (R2)
  | 'session'  // ad-hoc conversation (today's chat session)
  | 'remote'   // remote-control session (R4)
  | 'job';     // queue job projected as a session (R5)

type AgentsEntryStatus =
  | 'awaiting-input'  // blocked on the human — carries the special tag (R8)
  | 'running'         // spinner (R8)
  | 'idle'
  | 'failed'
  | 'done';
```

Containment, not siblinghood (**answers R3**): a perennial **agent** *has* sessions. The list is a two-level tree rendered flat with expansion — the agent row shows the **aggregate** status (most urgent of its sessions) and its own accumulated-history entry point; expanding reveals its sessions. This is the cheapest shape that satisfies both "accumulates history" and "several sessions each", and it keeps a single flat comparator for R9.

An entry carries: `id`, `kind`, `title`, `status`, `workspaceId` + `workspaceLabel` (for R10 and for the `rhanka/<repo>` line), `lastActivityAt`, `lastViewedAt`, optional `connection` (for `remote`/`agent`), optional `pendingPrompt` (the excerpt rendered in the tag/card), optional `parentAgentId`.

---

## 3. What exists today (verified on `main` @ `f8dea9af9`)

| Fact | Location |
|---|---|
| Tabs are `'chat' \| 'queue' \| 'comments'`, rendered as a 3-button header nav | `packages/chat-ui/src/components/ChatWidget.svelte:4,44–83` |
| Panel visibility is derived, not ad-hoc | `packages/chat-ui/src/state/chatWidgetShell.ts:93–105` |
| The package exposes jobs-panel injection points (`renderJobsPanel`, `onPurgeJobs`, `ChatUiJobsHostAdapter`) | `ChatWidget.svelte:17,19,87,99`; `hosts/createWebHost.ts` |
| **…but the live app does not use them.** It passes `renderShell={renderAppChatWidgetShell}` and renders `<QueueMonitor />` inside its own shell, so the package's tab bar is **never rendered in sentropic** | `ui/src/lib/components/ChatWidget.svelte:3221,3090`; gate at `ChatWidget.svelte:36` |
| The same union is declared **five times independently** — package component, its `.d.ts`, cowork-bridge, Chrome content, Chrome sidepanel — plus a hardcoded `'chat'` in the VSCode handoff | `ChatWidget.svelte:4`, `ChatWidget.svelte.d.ts:3`, `cowork-bridge/…/chatwidget-handoff.ts:1`, `ui/chrome-ext/content.ts:19`, `ui/chrome-ext/sidepanel.ts:8`, `ui/vscode-ext/webview-entry.ts:1230` |
| A durable workspace-scoped **agent entity already exists** in the API | `api/src/db/schema.ts:1090` (`agent_definitions`, `workspaceId` + `key`), exposed via `routes/api/agent-config.ts` |
| A **generic, async-capable storage adapter already exists** (`get/set/remove`, may return promises) | `hosts/createWebHost.ts:33–37` (`ChatUiStorageAdapter`) |
| chat-ui's packaged theme **already consumes DS `--st-*` tokens** (~40 references, incl. semantic borders and statuses) | `packages/chat-ui/src/theme/chat-ui.css` |
| App coerces/persists the active tab | `ui/src/lib/components/ChatWidget.svelte:83,422,513,530` |
| A session list component + pure projection already exist | `components/SessionList.svelte`, `state/sessionList.ts` |
| …but its view-model is **only** `{ id, title, lastActivity }` — **no status, no kind, no workspace, no pending question** | `state/sessionList.ts:38–46` |
| Sorting is a single `lastActivity` desc | `state/sessionList.ts:56–62` |
| ~~chat-ui is 100% hardcoded Tailwind, 0 `--st-*` tokens~~ — **stale**: that was `SPEC_EVOL_CHAT_ECOSYSTEM.md` §3.1's state, since superseded by the packaged theme above | — |
| `ChatWidgetTab` and `ChatWidgetPanelVisibility.showQueuePanel` are **public exports** | `src/index.ts:19` → `state/chatWidgetShell.ts:3,13` |
| `cowork-bridge` **re-declares** the same union instead of importing it → drift is compiler-invisible | `packages/cowork-bridge/src/core/chatwidget-handoff.ts:1` |
| Tab labels are host-injected props, and the app carries `queue*` i18n keys | `ChatWidget.svelte:9–11`; `ui/src/locales/{en,fr}.json` |
| `PlacementPersistence` is a single-slot placement adapter, **not** a generic KV store | `state/chatPlacement.ts:139–142` |
| Forced host modes override layout (sidepanel→docked, extension→floating) | `state/chatWidgetShell.ts:27–37` |

**Not existing today** (each is a dependency, not an oversight):
- **not** "no agent entity" — that entity exists (`agent_definitions`). What is missing is the **join** between an `agentDefinition` and its h2a instance/session presence, plus a listing endpoint over it. BR-39l's "no feed source in api" is about that join and that endpoint, not about identity;
- no per-user **last-consultation** timestamp anywhere (see D6 — R9 cannot be honoured without it; the *adapter* to store it locally does exist, the *state* does not);
- no cross-workspace session listing, and no authz projection for one (R10);
- no user↔user messaging capability at all (R6);
- the full-screen left rail depends on the **AppShell migration** already sequenced with the architect (step A app→AppShell, step B chat→PanelStack).

---

## 4. Decisions **[lane]**

**Owner ratifications, 2026-07-29** (these close the corresponding forks; the decisions below are amended accordingly):
- **D1a = GO.** The atomic breaking major release is authorised: one union source, all 6 sites, `chat-ui` **major** + `cowork-bridge` in lockstep. Remaining sub-question routed to the plugin lanes / architect: whether this lane performs the Chrome/VSCode edits itself.
- **D1c = the app returns the shell to the package.** Not "mount inside the app shell" — the full `renderShell` takeover is removed so that "shipped in chat-ui" means "visible in sentropic". Cost, measured rather than assumed: the app's `renderAppChatWidgetShell` snippet is **1014 lines** (`ui/src/lib/components/ChatWidget.svelte:2161–3175`), of which **~833 are the header alone** — the part that owns the tab bar. That is a sub-program, not a lot, and it cannot be one commit under the 150-line rule. So the handover is **incremental and header-first**: the package takes the tab bar and the list; the app keeps injecting its remaining header controls through named slots that shrink slice by slice. Each slice is independently shippable, and the tab bar genuinely moves in the first one — no façade.
- **O1 = an awaiting-input entry ranks above running ones.** So D3's bucket 1 is now decided, `awaitingInputFirst` is `true`, and the badge propagation of D19 is what makes a question buried in a delegated run reach the top of the list.
- **Sequencing consequence:** the shell handover lands **before** the rename. Renaming first would change a tab bar the user never sees (D1c), so L-C-shell precedes L-A′ — otherwise the release ships an invisible rename and a second, app-local rename has to follow.

**D1 — Tabs.** `ChatWidgetTab` becomes `'agents' | 'chats' | 'comments'`, in that render order. `'queue'` is **removed**, not aliased: no legacy fallback (MASTER rule). Migration of persisted user state happens inside the **existing** `coerceChatWidgetTab` seam (`state/chatWidgetShell.ts:19–25`), which already normalises unknown values — `'chat'→'agents'`, `'queue'→'agents'`, at read time.

**D1a — This is a BREAKING change to a published contract: a MAJOR bump, escalated, never self-merged.** `ChatWidgetTab` is public API (`src/index.ts:19` re-exports `state/chatWidgetShell.js`, union at line 3), and `ChatWidgetPanelVisibility.showQueuePanel` (line 13) with it. `rules/workflow.md` mandates **major for breaking** — for a 0.x package that means `@sentropic/chat-ui@1.0.0`, not a minor. The lane's standing authority covers *additive minor* only, so this needs an explicit owner GO. No deprecated-alias window: MASTER forbids legacy fallback, so the break is taken once, deliberately.

**D1b — The union is declared FIVE times independently, and the compiler will catch none of the drift.** Package component (`ChatWidget.svelte:4`), its `.d.ts` (line 3), `cowork-bridge/src/core/chatwidget-handoff.ts:1`, `ui/chrome-ext/content.ts:19`, `ui/chrome-ext/sidepanel.ts:8` — plus a hardcoded `activeTab: 'chat'` in `ui/vscode-ext/webview-entry.ts:1230`. Each re-declares the literals rather than importing them, so every one keeps compiling against a tab that no longer exists. Consequence: **R1 is one atomic multi-package release lot**, not a chat-ui edit — single source of truth for the union, every site importing it, an equality assertion where a local copy is unavoidable, and `cowork-bridge` bumped in lockstep. Ownership of the Chrome/VSCode edits must be confirmed with their lanes before L-A starts.

**D1c — And in sentropic today, renaming the package's tabs would change nothing the user sees.** `ChatWidget` short-circuits on `renderShell` (`ChatWidget.svelte:36`), and the app supplies the whole shell (`ui/src/lib/components/ChatWidget.svelte:3221`) while rendering `<QueueMonitor />` itself (line 3090). The visible tab bar is therefore **app-local**, and the package's is dead code in this host. So L-A must state which of the two it changes, and L-C owns the **shell boundary**: either the app stops taking over `renderShell`, or `AgentsList` mounts inside the app's shell. Shipping the package rename alone would look done and be invisible — the precise failure mode the no-orphan gate exists to catch.

**D2 — Feed port, not a feed.** chat-ui owns the **view-model and the components**, and consumes an injected `AgentsFeedPort` (`list(scope) → AgentsEntry[]`, plus an optional `subscribe` for live status). It does **not** reach for HTTP, h2a, or the queue itself. Consequence: **the whole surface is buildable and testable before any backend exists**, and every source (sessions, jobs, remote, h2a presence) is wired host-side, incrementally. This is the same lever that let the placement system ship ahead of the DS: *integrable without the dependency*.

**D3 — Ordering is a lexicographic comparator**, pure and unit-tested: `(urgencyBucket, recency)`.
Buckets: `1` = `awaiting-input` *(recommended — see O1)*, `2` = `running` (any kind), `3` = perennial `agent` not running, `4` = everything else.
**The recency key differs per bucket, deliberately:** buckets 1–2 sort by `lastActivityAt` desc (a working item is ranked by what it is doing, not by when I last looked at it — and the reference screenshot ranks by elapsed activity: `1m, 20m, 26m, 29m…`), buckets 3–4 sort by `lastViewedAt` desc, which is R9's "age of last consultation". Direction is **most-recent-first**, established by the reference screenshot's ascending elapsed times, not assumed.
**Bucket 1 is conditional on O1, not decided here.** R9 puts running items first; giving `awaiting-input` its own top bucket *overrides* R9, so it is a parameter of the comparator (`awaitingInputFirst: boolean`) defaulting to the R9-literal reading until the owner answers O1. Writing it as decided would have contradicted the requirement it claims to implement.
**The sort is hierarchical, not flat.** Roots (agents and parentless sessions) are ordered by the buckets above using their *aggregate* status; children are ordered *within their parent*. A single flat comparator would interleave the sessions of two expanded agents, which is not a list anyone can read.

**D4 — Status rendering.** `running` → spinning wheel; `awaiting-input` → the special tag + the `pendingPrompt` excerpt card; `failed` → error affordance. Colors come from the DS status tokens. This is **not** a tokenization beachhead — `packages/chat-ui/src/theme/chat-ui.css` already consumes ~40 `--st-*` references including semantic borders and statuses. The work is therefore to **extend the existing theme generator** with the new component classes and to cover them in the packaged-theme tests, not to introduce tokenization.

**D5 — Jobs are a projection, not a migration — and the projection must not lose the panel's functionality.** Queue tables and endpoints are untouched; a pure adapter projects a job row into an `AgentsEntry{kind:'job'}`. Two constraints the naïve version would break:
- `QueueMonitor.svelte` today offers per-row **stream history and cancel/retry/delete**, not just a status. A `job` entry must keep those as kind-specific actions and a details view; `Purge` moves from the tab header into the list's overflow menu. Absorbing jobs into a list that can only *show* them would be a functional regression sold as a unification.
- **`chat_message` jobs already reference a session** (`api/src/services/queue-manager.ts:411`), so projecting them as siblings would show the same conversation twice — once as a session, once as a job. They merge **into their session's status** instead of becoming their own row. (Note: `ui/src/lib/stores/queue.ts:132` drops that type from live updates today, so the merge needs its own source check.)

**D6 — Last consultation is real state that does not exist yet.** R9's "age of last consultation" is per-`(principal, entry)` and is **not** `updatedAt`. Two-step: **(a)** client-local `lastViewedAt` so R9 works immediately; **(b)** API-backed `lastViewedAt` so it is coherent across devices. (b) is an api-lane dependency, not a chat-ui one.
(a) is built **over the adapter that already exists**: `ChatUiStorageAdapter` (`hosts/createWebHost.ts:33–37`) is a generic `get/set/remove` whose methods may return promises. Two consequences: no new port is invented, and the view-marker API must be **async-tolerant** — a synchronous port could not be implemented over `chrome.storage`, which the Chrome host uses (`ui/chrome-ext/content.ts:34`). Markers are namespaced by principal + workspace + kind. (Earlier draft claimed no reusable adapter existed and specified a synchronous port; both were wrong. `PlacementPersistence` is placement-specific, but it is not the only adapter.)

**D7 — Scope toggle is a backend parameter, not a client filter.** R10's "all workspaces" cannot be a client-side `filter()` over a workspace-scoped payload — it needs the API to authorize per workspace and project **only** what the principal may see, deny-as-missing (Resource Plane RF decisions). Until that endpoint exists, the toggle is **rendered disabled with a reason**, never silently lying by showing one workspace while claiming all.

**D8 — `chats` (R6) is a separate program, not a tab rename.** Inter-user threads, participants, presence, unread state, notifications, and *an AI agent as a participant* are new backend capabilities touching auth (principals/memberships), the event spine, and h2a authority. It gets its own BR and its own spec; the `agents` work must not be gated on it. **Until L-G lands, `chats` renders disabled with a stated reason.** An earlier draft proposed relabelling the existing AI assistant chat as `chats` and called that honest; it is not — the assistant conversation's home is `agents`, so putting it under `chats` too would give one thread two homes, which is exactly what O4 forbids. Same rule as the scope toggle (D7): a surface that cannot yet do what its name promises says so.

**D9 — Agent-as-participant is an authority question, not a UI one.** When a perennial agent posts into a user↔user thread it acts under a **MANDATE**; what it may read of that thread, and on whose behalf it speaks, is an h2a/auth decision. Flagged for the h2a and auth lanes **before** any implementation of R6.

**D10 — Remote-control sessions are read-only in this surface (first cut).** The `agents` list *surfaces* them (status, workspace, elapsed); attaching/controlling stays in the cowork surface. Prevents this lane from absorbing the remote-session control plane.

**D11 — Full-screen left rail (R11) lands on step B.** The rail + repositionable side column are exactly the `AppShell` + `PanelStack` composition already sequenced with the architect: **step A** = app migrates to `AppShell` (`sentropic:app` lane), **step B** = chat migrates to `PanelStack` (this lane). R11 is therefore **scheduled after step A**, and the non-full-screen surface (R1–R10) must be complete and shippable **without** it. The DS half is no longer the constraint — `PanelStack`/`PanelSection` were reported published on 2026-07-28 (§6). The single remaining gate is step A, whose relay to the architect was sent 2026-07-29T04:20Z and is awaiting organisation.
**Precision on *why* it is gated, because the obvious reason is wrong.** Full-screen itself needs nothing: `full` is already a viewport-level container (`state/chatPlacementClasses.ts`) and `ChatDock` already accepts arbitrary host content. What needs the app's shell is R11's *composition* — a **tab rail** and a **repositionable side column** living beside the app's own regions rather than floating over them. And the owner's standing requirement stands: the chat must remain integrable **without** AppShell, so step A changes the container, never the capability.

**D12 — Side memory is reused, not reinvented — but it must first be made readable.** The left/right choice for the session column reuses the shared side-memory shipped in `chatPlacementMenu.ts`, so the chat panel and its session column stay on the same side — the coherence the owner asked for on placement. **Blocker to clear first:** `ChatPlacementSideMemory` is declared *without* `export` (line 155) and the public `ChatPlacementMenu` type (line 216) exposes no side accessor or setter, so nothing outside the module can read or set the remembered side — and in `full` mode the menu returns only the mode group. A small **additive** public side-preference accessor must therefore land in an earlier lot (L-A), or L-F cannot implement R11's "left or right, repositionable" at all.

**D13 — One default view per tab, but not in every host.** R8 makes the **list** the default landing view of a tab, and the conversation a **push** on top of it — a navigation-state change (`list | entry`) in `chatWidgetShell`, with the current session restored as `entry` when the user returns mid-conversation.
**Forced host modes are excluded.** `resolveEffectiveChatWidgetMode` (`chatWidgetShell.ts:27–37`) forces `docked` in a sidepanel and `floating` in the extension overlay; landing those narrow surfaces on a list instead of the conversation the user just opened would be a regression of exactly the kind the placement work already hit. So D13 gets the same shared-predicate treatment as `canChatPlacementMenuOwnPlacement`: a single `canAgentsListBeDefaultView(hostMode, isExtensionOverlayHost, isMobileViewport)` predicate, used by both the component and its tests — one place to be right.
**The view state is not representable today, and "restore the entry" collides with existing behaviour.** The handoff persists `activeTab` + `chatSessionId` but no `list | entry` view (`cowork-bridge/src/core/chatwidget-handoff.ts:5`), so a non-null session id cannot distinguish "list showing, session alive in the background" from "entry open"; and `AppChatPanel.svelte` already auto-selects the first session (line 2334) and restores its messages (line 2917). D13 therefore requires: a **persisted per-tab view state** (a new field, additive), an explicit **transition table** (tab switch, entry select, back, external `open_session`, mid-stream return), and **decoupling runtime session selection from visible navigation** — a session may be live without being displayed. Until that is written, §8's "returning restores the list" and "current session restored as entry" are contradictory, which the acceptance criteria must not encode.

**D15 — R13 is not new design: it is the execution of RF11, and RF11 already names this lane.** `SPEC_EVOL_RESOURCE_FS.md` §3.4ter / §8 records owner decision **RF11 = A+C-controlled, DECIDED 2026-06-08**: ONE normalized `ToolInteractionTrace` (`{toolCallId, toolName, executionMode: 'resource_terminal'|'local_bash'|'tool', terminal?: {streamId, exitCode?}, touches[], provenance}`) as the floor; **chat-ui renders file chips + an expandable terminal pane over `StreamBuffer`**, per-tool `interactionTrace` opt-in, plus an optional per-tool `customRenderer` fed the *same* typed trace; and verbatim: *"the renderer registry + sandboxing is a chat-ui deliverable; v0 ships the default renderer"*. So this lane does **not** invent a tool/terminal event model — it implements the decided one, co-designed with **BR-70** (`feat/arch21a-resource-plane`), which ships the view/diff over `read` + `documents` + `StreamBuffer`. Building a parallel tool-rendering path here would be exactly the duplicated-pattern failure the DS/placement work already taught us to avoid.

**D15a — The current renderer registry cannot carry it, and that is a public-surface change.** `renderers/registry.ts` types a renderer as `ToolRenderer = (input) => output` with a `JSON.stringify` default — a **string transformer**, not a component registry. RF11 needs a *component* registry (terminal pane, chips, sandboxed custom renderer). Introduced as a **new, additive** registry alongside the existing one (which keeps working) so this is a minor bump, unlike D1a.

**D16 — One normalized run-event envelope; `ToolInteractionTrace` is its tool member, not a rival.** A CLI transcript carries more than tool calls: messages, reasoning, status, elicitations, background tasks, delegated runs. So the model is an `AgentRunEvent` envelope whose `kind: 'tool'` payload **is** the RF11 trace verbatim. Extend, never fork: two competing tool-event shapes would guarantee divergence between sentropic's own runs and foreign ones.

**D17 — One transcript adapter per CLI host; the adapter is the only place that knows a native format.** `claude`, `codex`, `agy`, `openrouter`, `hermes` each persist differently. Each adapter parses native → `AgentRunEvent[]`; everything above is host-agnostic and fixture-tested. h2a is the natural source for *which* sessions exist per host — it already holds presence, `launchContext` (cwd, command, tmux pane) and the workspace mapping, which is precisely the `rhanka/<repo>` line of the reference screenshot.

**D18 — Typed elicitation replaces a literal boolean.** R14's "only yes/no" is exact: the gate today is the boolean `todoAwaitingUserInput` (`packages/chat-core/src/runtime-finalization.ts:176,191`; `runtime.ts:1183`) — yes/no *by construction*, not by choice. Replacement is a typed request with a response schema: `choice` (single/multi), `text`, `secret`, `approve-diff`, `pick-resource`; plus explicit `accept | decline | cancel` and a timeout. Reuse the shape already studied in `SPEC_STUDY_39_MCP_AUTHKIT_ELICITATION_GAPS.md` (MCP elicitation + `elicitation_id/sub/tid/server/mode/action` audit event, carried by the `ToolInteractionTrace`) instead of inventing a third dialect. The pending-question **tag** of R8 is the list-level projection of exactly this state.

**D19 — Background tasks and subagent runs are nested runs, so containment goes one level deeper.** §2's tree becomes `agent → sessions → runs → child runs`, one recursive renderer, children collapsed by default, status aggregated upward. That aggregation is what makes an `awaiting-input` deep inside a delegated run surface as the badge on the top-level list row — otherwise a subagent blocked on a question stays invisible, which is the failure mode this whole surface exists to remove.

**D20 — Displaying a foreign CLI session is not controlling it.** R12 ships **read-only**: render the transcript, surface the status. Sending input into a foreign CLI session is a separate capability, and for remote ones it belongs to the cowork/remote-control plane (D10). Otherwise this lane silently becomes a multi-CLI control plane.

**D21 — Foreign transcripts are an egress boundary, and the spec says so before anyone is surprised.** CLI transcripts contain terminal output, file contents, env values and occasionally credentials. Rendering them in a web app moves that data from a local file into an authenticated web surface, its caches and its logs. Floor: transcripts stay **own-principal**, are never persisted server-side by this surface, and terminal output goes through the same redaction posture the bank connector imposed on traces (metadata-first, no blind capture). Cross-principal visibility of a foreign transcript is **out of scope** and needs an explicit owner decision.

**D14 — Every lot is test-first and fail-first-verified.** Comparator, migration, projection and status mapping are pure functions with node-testable unit tests; the list/rail get semantic DOM tests; the tab migration gets an e2e assertion on the persisted-state path. No assertion that cannot fail.

---

## 5. Lot plan **[lane]**

| Lot | Content | Depends on | Shippable without backend |
|---|---|---|---|
| **L-A** | `AgentsEntry` types + `AgentsFeedPort` (D2) + comparator (D3 — O1-gated, hierarchical) + view markers over `ChatUiStorageAdapter` (D6a) + **public side-preference accessor** (D12) — all **additive**, no rename | — | **yes** |
| **L-C-shell** | **Incremental shell handover** (D1c, owner-ratified): the package owns the tab bar + list; the app's 1014-line `renderShell` takeover is dismantled header-first into named slots, one shippable slice per commit | L-A, L-B | **yes** |
| **L-A′** | The **atomic breaking release** (D1/D1a/D1b): one union source, all 6 declaration/usage sites migrated (package, `.d.ts`, cowork-bridge, Chrome ×2, VSCode), equality assertions, i18n keys, `chat-ui` **major** + `cowork-bridge` lockstep — **after** L-C-shell so the rename is visible | owner GO ✅ ; Chrome/VSCode lane confirmation | yes |
| **L-B** | `AgentsList` component: item row (icon/name/elapsed/connection/workspace), spinner, pending tag + excerpt card, theme-generator extension (D4), expansion of an agent into its sessions (D3/§2) | L-A | **yes** (fixture feed) |
| **L-C** | Host wiring in `ui/`: the **shell-boundary decision** (D1c) + sessions adapter + **jobs projection with actions preserved** (D5) + per-tab view state & transition table (D13) | L-A, L-B | **yes** |
| **L-D** | Scope menu (R10) — rendered **disabled with reason** until the api endpoint exists (D7) | L-C | partially |
| **L-E** | Remote-control read-only adapter (D10) + perennial-agent adapter over the h2a/api feed | api/h2a feed source | **no** |
| **L-F** | Full-screen left rail + repositionable session column (R11, D11/D12) | step A (AppShell) | **no** |
| **L-G** | `chats` inter-user program (R6, D8/D9) — separate BR, separate spec | auth, event spine, h2a | **no** |
| **L-H** | `AgentRunEvent` envelope (D16) + **one transcript adapter per CLI host** (D17) + nested-run tree (D19), read-only (D20), redaction floor (D21) | h2a for session inventory | **yes** (fixture transcripts) |
| **L-I** | **RF11 v0 in chat-ui** (D15): component renderer registry (D15a), file chips over `documents`, expandable terminal pane over `StreamBuffer`, `customRenderer` slot | co-design with **BR-70** | **yes** for the registry + terminal pane; chips' `read` needs the plane |
| **L-J** | Typed elicitation (D18): request/response schemas, `accept\|decline\|cancel`, timeout, audit trace; list-level pending-question tag wiring | chat-core (boolean → typed) | **partially** — the UI yes, the runtime change is chat-core |

L-A → L-C are self-contained and are the ones that make the surface real. L-E/L-F/L-G are each gated on another lane and must not be started inside this branch.

---

## 6. Dependency declination (what this lane needs from whom)

| Capability | Needed for | Owner lane | Artifact expected | Blocks |
|---|---|---|---|---|
| Session/status/connection feed exposed by the **api** | R2, R3, R4 real data | `api` + `h2a` | endpoint returning sessions, status, connection | L-E |
| Cross-workspace listing **with per-workspace authz projection** (deny-as-missing) | R10 | `api` (+ ARCH-21 resource plane) | scope parameter + authorized projection | L-D (toggle stays disabled) |
| Per-principal `lastViewedAt` persistence | R9 across devices | `api` | read-marker write + read | D6b (D6a unblocks locally) |
| Remote-control session inventory | R4 | `cowork` | list + status + connection state | L-E |
| **AppShell migration of the app** | R11 left rail | `sentropic:app` (step A, organised by `architect`) | app on `AppShell` | L-F |
| ~~`PanelStack` exported by the DS~~ | R11 side column | `design-system` | **reported delivered** 2026-07-28: `PanelStack` + `PanelSection` exported from all 4 framework indexes, `@sentropic/design-system-svelte@0.34.73` (DS lane h2a event; version not independently verified by this lane yet — confirm at L-F entry) | ~~L-F~~ — no longer blocking |
| Inter-user threads + participants + notifications | R6 | `auth` + api + event spine | thread model & wire | L-G |
| Agent-as-participant authority (MANDATE scope in a user thread) | R6 safely | `h2a` + `auth` | decision | L-G |
| `ToolInteractionTrace` emission + `read`/`documents`/`StreamBuffer` seams (RF11 floor) | R13 with real data | **BR-70** `arch21a-resource-plane` | the decided RF11 contract, emitted | L-I beyond fixtures |
| Session inventory per CLI host (which sessions, where, tmux pane, workspace) | R12 | `h2a` | a listing this lane can consume | L-H beyond fixtures |
| Typed elicitation in the runtime (boolean → typed request) | R14 | `chat-core` (+ MCP elicitation study) | typed request/response events | L-J runtime half |
| Redaction/egress posture for foreign transcripts (D21) | R12 safely | `architect` + owner | confirmation of the own-principal, no-server-persistence floor | L-H merge |
| **GO on a breaking `chat-ui` MAJOR bump** (D1a) | R1 at all | **owner** | explicit GO | L-A′ |
| Confirmation that this lane may edit the **Chrome and VSCode** surfaces (or their lanes do it) | R1 without leaving dead literals | plugin lanes / `architect` | ownership answer | L-A′ |
| Join `agent_definitions` ↔ h2a instance/session presence (the real BR-39l gap) | R2, R3 with real data | `api` + `h2a` | reconciliation contract, then the endpoint | L-E |

---

## 7. Open forks — for the owner (batched)

**O1 — CLOSED 2026-07-29: yes, a pending question outranks a running item.** Folded into D3 (`awaitingInputFirst = true`).

**O2 — Perennial-agent history: one continuous thread or a list of sessions?** R3 leaves it open. *Recommendation: the agent row expands into its sessions (newest first) and its "accumulated history" is a virtual continuous view across them — no data migration, no loss of session boundaries.*

**O3 — Does the `agents` list show *other people's* agents?** In a shared workspace, perennial agents are workspace-scoped, so several principals may see the same agent. *Recommendation: yes for perennial agents (they hold a workspace role), no for ad-hoc sessions (own-principal only) — matching the BR-39l read-only own-principal posture.*

**O4 — When `chats` becomes inter-user, does the assistant conversation stay reachable from `chats`, or only from `agents`?** *Recommendation: only from `agents` — one home per conversation kind, otherwise the same thread appears twice.*

**O6 — Which CLI host first, and is the transcript read live or on open?** Five hosts (R12) is five parsers. *Recommendation: `claude` first (its transcript is the one already on this machine, and it is the format the reference screenshot mirrors), then `codex`; tail-live only for the session currently running, on-open snapshot for the rest — tailing five idle transcripts buys nothing and costs a watcher each.*

**O7 — How deep does a delegated run render by default?** A subagent can itself delegate. *Recommendation: render one level expanded, deeper levels collapsed with a count — and always propagate an `awaiting-input` badge to the top regardless of depth, since that is the state a human must not miss.*

**O5 — Naming of the removed `Jobs` tab in the UI.** Jobs become sessions (R5), so the word disappears from the tab bar. *Recommendation: keep a `job` kind icon + a filter in the list's menu, so a user who thinks in "jobs" still finds them.*

---

## 8. Acceptance

- `ChatWidgetTab` is `'agents' | 'chats' | 'comments'`; no `'queue'` remains in the package; a persisted `'chat'`/`'queue'` state migrates on read (unit + e2e).
- The comparator reproduces R9's exact ordering over a fixture set mixing all four kinds and all five statuses (unit, fail-first verified).
- A running entry renders a spinner; an `awaiting-input` entry renders the tag + excerpt; both assert on DS status tokens, not on hex (semantic DOM test).
- A tab switch lands on the **list** where D13's predicate allows it; selecting an entry pushes the conversation; going back restores the list. The transition table is the test oracle — a live-but-not-displayed session must not force `entry` (e2e + unit).
- A `job` entry still exposes cancel/retry/delete and its stream history; a `chat_message` job does **not** appear as its own row (unit + e2e) — the anti-regression gate on D5.
- The package's tab bar and the app's shell do not disagree: whichever survives D1c, exactly one tab bar renders, and a test asserts the count (semantic DOM).
- The scope toggle either lists across workspaces **or** is disabled with a stated reason — never claims a scope it does not have (unit + e2e).
- No app-local reimplementation: every piece of the surface is consumed from `@sentropic/chat-ui` by `ui/` (no-orphan gate).

---

## 9. Review log

**Round 1 — lane self-review (Opus), 2026-07-29.** Findings folded into D1a, D1b, D3, D6, D13 and the §3 fact table. Four of them invalidated a first-draft claim: `ChatWidgetTab` is public (so R1 is a breaking change, not a rename); `cowork-bridge` duplicates the union (so the break is compiler-invisible); there is no reusable persistence adapter for `lastViewedAt`; and list-as-default would regress the forced host modes. All five are grounded on file:line, none on inference.

**Round 2 — independent adversarial peer (Codex `gpt-5.6-sol`, xhigh), 2026-07-29: VERDICT `RECONSIDER`, 11 findings.** I re-verified the seven load-bearing ones against the code myself rather than taking them on trust; all seven held, and they invalidated more of my draft than round 1 did:

| # | Finding | Adjudication |
|---|---|---|
| 1 | R1 is a coordinated multi-package **major** release, not a chat-ui edit — 6 declaration/usage sites | **ACCEPT** (verified all sites). → D1a, D1b, new lot L-A′ |
| 2 | The live app takes over `renderShell` and renders `QueueMonitor` itself, so the package tab bar is dead code here | **ACCEPT** (verified `:3221`, `:3090`, `:36`) → **D1c**, L-C owns the shell boundary. The most consequential finding: the rename alone would have been invisible |
| 3 | "No agent entity in the API" is false — `agent_definitions` exists | **ACCEPT** (verified `schema.ts:1090`). The gap is the presence **join**, not identity → §3, §6, L-E |
| 4 | A generic async storage adapter already exists; my synchronous port was both redundant and unimplementable on `chrome.storage` | **ACCEPT** (verified `createWebHost.ts:33–37`) → D6 |
| 5 | D13's navigation state is not representable and collides with existing auto-restore | **ACCEPT** → D13 now requires a persisted per-tab view state + transition table |
| 6 | D5's projection would drop cancel/retry/delete and duplicate `chat_message` jobs | **ACCEPT** → D5 + a named anti-regression acceptance criterion |
| 7 | D3 contradicted R9 while O1 was still open; a flat comparator interleaves children | **ACCEPT** → bucket 1 is now O1-gated, sort is hierarchical |
| 8 | D12 cannot reuse the side memory — it is unexported with no public accessor | **ACCEPT** (verified) → additive accessor moved into L-A |
| 9 | The AppShell gate is asserted, and the cited placement spec is absent from HEAD | **PARTIAL** — the dangling citation was real and is fixed (the reference is PR #429 / `4a17ca211`); `full` indeed needs nothing. But the gate stands for R11's *composition* (rail + repositionable column), so the reason was rewritten rather than the gate removed |
| 10 | "0 `--st-*` tokens" is false — the packaged theme already uses ~40 | **ACCEPT** (verified) → D4 is theme-generator extension, not a beachhead |
| 11 | D8 shipped the wrong capability under `chats` and contradicted my own O4 | **ACCEPT** → `chats` renders disabled with a reason until L-G |

Net effect: R1 moved from "a lot" to "a gated, owner-approved atomic release", three §3 facts were false and are corrected, and two decisions (D6, D12) were rewritten around code that already existed. Round 3 is not required before the owner packet; it **is** required before L-A′ merges, since that lot touches four surfaces at once.

