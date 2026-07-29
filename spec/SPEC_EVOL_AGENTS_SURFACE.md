# SPEC_EVOL — Agents Surface (`agents | chats | comments`)

Status: **SEDIMENTED INTENTION — decisions D1–D14 drafted, O1–O5 open for owner, awaiting double adversarial review.**
Owner lane: `sentropic-chat` (chat ecosystem). Cross-lane dependencies declared in §6 — this lane does NOT own them.
Baseline: `main` @ `f8dea9af9` (`@sentropic/chat-ui@0.29.0`, placement system L1c+L2 merged in #429).
Source: owner utterance 2026-07-29 (FR), recorded as the requirement set R1–R11 below. §1 is a faithful restatement, not an interpretation; every design addition of mine is marked **[lane]** and lives in §4–§5.
Relates to: `SPEC_EVOL_CHAT_ECOSYSTEM.md` (WP-CHAT program), `SPEC_EVOL_CHAT_SURFACES.md` (D1–D13 placement, shipped through L2), `SPEC_EVOL_H2A_ROLES_SCOPES.md` (perennial roles), BR-58 `SPEC_EVOL_H2A_CHAT`, BR-70/71 Resource Plane (`/agents` mount), BR-39l (h2a sessions in the web app).

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
| Jobs panel + purge are **injected by the host** (`renderJobsPanel`, `onPurgeJobs`) | `ChatWidget.svelte:17,19,87,99` |
| App coerces/persists the active tab | `ui/src/lib/components/ChatWidget.svelte:83,422,513,530` |
| A session list component + pure projection already exist | `components/SessionList.svelte`, `state/sessionList.ts` |
| …but its view-model is **only** `{ id, title, lastActivity }` — **no status, no kind, no workspace, no pending question** | `state/sessionList.ts:38–46` |
| Sorting is a single `lastActivity` desc | `state/sessionList.ts:56–62` |
| chat-ui is 100% hardcoded Tailwind, **0 `--st-*` tokens** | `SPEC_EVOL_CHAT_ECOSYSTEM.md` §3.1 |

**Not existing today** (each is a dependency, not an oversight):
- no "agent" entity in the API — perennial identity lives in the h2a bus (presence/instances), and BR-39l is **blocked precisely on "no feed source in api"**;
- no per-user **last-consultation** timestamp anywhere (see D6 — R9 cannot be honoured without it);
- no cross-workspace session listing, and no authz projection for one (R10);
- no user↔user messaging capability at all (R6);
- the full-screen left rail depends on the **AppShell migration** already sequenced with the architect (step A app→AppShell, step B chat→PanelStack).

---

## 4. Decisions **[lane]**

**D1 — Tabs.** `ChatWidgetTab` becomes `'agents' | 'chats' | 'comments'`, in that render order. `'queue'` is **removed**, not aliased: no legacy fallback (MASTER rule). The app's `coerceChatWidgetTab` migrates persisted `'chat'→'agents'` and `'queue'→'agents'` **once**, at read time.

**D2 — Feed port, not a feed.** chat-ui owns the **view-model and the components**, and consumes an injected `AgentsFeedPort` (`list(scope) → AgentsEntry[]`, plus an optional `subscribe` for live status). It does **not** reach for HTTP, h2a, or the queue itself. Consequence: **the whole surface is buildable and testable before any backend exists**, and every source (sessions, jobs, remote, h2a presence) is wired host-side, incrementally. This is the same lever that let the placement system ship ahead of the DS: *integrable without the dependency*.

**D3 — Ordering is a lexicographic comparator**, pure and unit-tested: `(urgencyBucket, kindBucket, recency)`.
Buckets: `1` = `awaiting-input` *(recommended — see O1)*, `2` = `running` (any kind), `3` = perennial `agent` not running, `4` = everything else. Within a bucket: `lastViewedAt` desc, `lastActivityAt` desc as tiebreak.

**D4 — Status rendering.** `running` → spinning wheel; `awaiting-input` → the special tag + the `pendingPrompt` excerpt card; `failed` → error affordance. New components use **DS `--st-*` tokens** (status semantics: info/warning/error), not the ad-hoc Tailwind palette that the rest of chat-ui still carries. This makes the agents surface the **tokenization beachhead** for chat-ui rather than adding to the debt.

**D5 — Jobs are a projection, not a migration.** Queue tables and endpoints are untouched; a pure adapter projects a job row into an `AgentsEntry{kind:'job'}`. The `Purge` action moves from the tab header into the list's overflow menu.

**D6 — Last consultation is real state that does not exist yet.** R9's "age of last consultation" is per-`(principal, entry)` and is **not** `updatedAt`. Two-step: **(a)** client-local `lastViewedAt` (persisted through the existing chat-ui persistence adapter) so R9 works immediately; **(b)** API-backed `lastViewedAt` so it is coherent across devices. (b) is an api-lane dependency, not a chat-ui one.

**D7 — Scope toggle is a backend parameter, not a client filter.** R10's "all workspaces" cannot be a client-side `filter()` over a workspace-scoped payload — it needs the API to authorize per workspace and project **only** what the principal may see, deny-as-missing (Resource Plane RF decisions). Until that endpoint exists, the toggle is **rendered disabled with a reason**, never silently lying by showing one workspace while claiming all.

**D8 — `chats` (R6) is a separate program, not a tab rename.** Inter-user threads, participants, presence, unread state, notifications, and *an AI agent as a participant* are new backend capabilities touching auth (principals/memberships), the event spine, and h2a authority. It gets its own BR and its own spec; the `agents` work must not be gated on it. Until it lands, the `chats` tab ships as the **existing single-thread assistant chat** under its new name — honest, not stubbed.

**D9 — Agent-as-participant is an authority question, not a UI one.** When a perennial agent posts into a user↔user thread it acts under a **MANDATE**; what it may read of that thread, and on whose behalf it speaks, is an h2a/auth decision. Flagged for the h2a and auth lanes **before** any implementation of R6.

**D10 — Remote-control sessions are read-only in this surface (first cut).** The `agents` list *surfaces* them (status, workspace, elapsed); attaching/controlling stays in the cowork surface. Prevents this lane from absorbing the remote-session control plane.

**D11 — Full-screen left rail (R11) lands on step B.** The rail + repositionable side column are exactly the `AppShell` + `PanelStack` composition already sequenced with the architect: **step A** = app migrates to `AppShell` (`sentropic:app` lane), **step B** = chat migrates to `PanelStack` (this lane). R11 is therefore **scheduled after step A**, and the non-full-screen surface (R1–R10) must be complete and shippable **without** it.

**D12 — Side memory is reused, not reinvented.** The left/right choice for the session column reuses the shared side-memory already shipped in `chatPlacementMenu.ts` (`ChatPlacementSideMemory`), so the chat panel and its session column stay on the same side — the exact coherence the owner asked for on placement.

**D13 — One default view per tab.** R8 makes the **list** the default landing view of a tab, and the conversation a **push** on top of it. That is a navigation-state change (`list | entry`) in `chatWidgetShell`, with the current session restored as `entry` when the user returns mid-conversation.

**D14 — Every lot is test-first and fail-first-verified.** Comparator, migration, projection and status mapping are pure functions with node-testable unit tests; the list/rail get semantic DOM tests; the tab migration gets an e2e assertion on the persisted-state path. No assertion that cannot fail.

---

## 5. Lot plan **[lane]**

| Lot | Content | Depends on | Shippable without backend |
|---|---|---|---|
| **L-A** | `AgentsEntry` types + `AgentsFeedPort` + comparator (D3) + `lastViewedAt` local store (D6a) + tab rename & migration (D1) | — | **yes** |
| **L-B** | `AgentsList` component: item row (icon/name/elapsed/connection/workspace), spinner, pending tag + excerpt card, DS tokens (D4), expansion of an agent into its sessions (D3/§2) | L-A | **yes** (fixture feed) |
| **L-C** | Host wiring in `ui/`: sessions adapter + **jobs projection** (D5) + list-as-default navigation (D13) + purge relocation | L-A, L-B | **yes** |
| **L-D** | Scope menu (R10) — rendered **disabled with reason** until the api endpoint exists (D7) | L-C | partially |
| **L-E** | Remote-control read-only adapter (D10) + perennial-agent adapter over the h2a/api feed | api/h2a feed source | **no** |
| **L-F** | Full-screen left rail + repositionable session column (R11, D11/D12) | step A (AppShell) | **no** |
| **L-G** | `chats` inter-user program (R6, D8/D9) — separate BR, separate spec | auth, event spine, h2a | **no** |

L-A → L-C are self-contained and are the ones that make the surface real. L-E/L-F/L-G are each gated on another lane and must not be started inside this branch.

---

## 6. Dependency declination (what this lane needs from whom)

| Capability | Needed for | Owner lane | Artifact expected | Blocks |
|---|---|---|---|---|
| Perennial-agent + session feed exposed by the **api** (the BR-39l blocker: "no feed source in api") | R2, R3, R4 real data | `api` + `h2a` | endpoint returning agent identity, sessions, status, connection | L-E |
| Cross-workspace listing **with per-workspace authz projection** (deny-as-missing) | R10 | `api` (+ ARCH-21 resource plane) | scope parameter + authorized projection | L-D (toggle stays disabled) |
| Per-principal `lastViewedAt` persistence | R9 across devices | `api` | read-marker write + read | D6b (D6a unblocks locally) |
| Remote-control session inventory | R4 | `cowork` | list + status + connection state | L-E |
| **AppShell migration of the app** | R11 left rail | `sentropic:app` (step A, organised by `architect`) | app on `AppShell` | L-F |
| `PanelStack` exported by the DS | R11 side column | `design-system` | published version | L-F |
| Inter-user threads + participants + notifications | R6 | `auth` + api + event spine | thread model & wire | L-G |
| Agent-as-participant authority (MANDATE scope in a user thread) | R6 safely | `h2a` + `auth` | decision | L-G |

---

## 7. Open forks — for the owner (batched)

**O1 — Does a pending question outrank a running item?** R9 lists "running at the top" and R8 says a pending question gets a special tag, but not whether it re-sorts. *Recommendation: yes — an item blocked on you is more urgent than one that is working. It would sit above the running ones.*

**O2 — Perennial-agent history: one continuous thread or a list of sessions?** R3 leaves it open. *Recommendation: the agent row expands into its sessions (newest first) and its "accumulated history" is a virtual continuous view across them — no data migration, no loss of session boundaries.*

**O3 — Does the `agents` list show *other people's* agents?** In a shared workspace, perennial agents are workspace-scoped, so several principals may see the same agent. *Recommendation: yes for perennial agents (they hold a workspace role), no for ad-hoc sessions (own-principal only) — matching the BR-39l read-only own-principal posture.*

**O4 — When `chats` becomes inter-user, does the assistant conversation stay reachable from `chats`, or only from `agents`?** *Recommendation: only from `agents` — one home per conversation kind, otherwise the same thread appears twice.*

**O5 — Naming of the removed `Jobs` tab in the UI.** Jobs become sessions (R5), so the word disappears from the tab bar. *Recommendation: keep a `job` kind icon + a filter in the list's menu, so a user who thinks in "jobs" still finds them.*

---

## 8. Acceptance

- `ChatWidgetTab` is `'agents' | 'chats' | 'comments'`; no `'queue'` remains in the package; a persisted `'chat'`/`'queue'` state migrates on read (unit + e2e).
- The comparator reproduces R9's exact ordering over a fixture set mixing all four kinds and all five statuses (unit, fail-first verified).
- A running entry renders a spinner; an `awaiting-input` entry renders the tag + excerpt; both assert on DS status tokens, not on hex (semantic DOM test).
- A tab switch lands on the **list**; selecting an entry pushes the conversation; returning restores the list (e2e).
- The scope toggle either lists across workspaces **or** is disabled with a stated reason — never claims a scope it does not have (unit + e2e).
- No app-local reimplementation: every piece of the surface is consumed from `@sentropic/chat-ui` by `ui/` (no-orphan gate).
