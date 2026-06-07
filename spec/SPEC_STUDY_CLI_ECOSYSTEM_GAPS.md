# SPEC STUDY — CLI ecosystem gap-coverage: harness completions, cross-CLI modifications, BR-42 coordination & h2a dispatch

Status: **Scoping / brainstorm (planning-only)**. No code, no branch. Decision-oriented. Capitalises the atomic method mapping (2026-06-03), partitions the work (BR25 vs BR-42 vs dispatched actors), and carries the h2a dispatch packets.

Lineage: extends `spec/SPEC_STUDY_HARNESS_WORKFLOW_ARTICULATION.md`. Touches specs OUTSIDE sentropic: `../track/INTENTION.md` + `../track/src/model/item.ts`, `spec/SPEC_VOL_GRAPHIFY.md`, `../agent-stats/`.

## Review log
- **2026-06-03 (draft)** — Authored after the atomic mapping (Codex+Opus iterated) and user directives (harness↔track, sec/archi/data in harness, graphify→KM + agent-stats, hermes-vs-graphify, BR-42 coordinator).
- **2026-06-03 (this revision)** — Hardened after a double adversarial review of the draft (Codex 5.5-xhigh + Opus 4.8). Both converged: the draft **wrongly reversed the harness→track direction** (re-introducing the coupling/circular-dep the articulation spec forbids) and **promoted track's WorkPackage into core** (contradicting track's twice-validated "WP out of core"). Corrected per their consensus (see §2/§3/§5). h2a actors named from live discovery.

### Must-fixes applied from the double review (traceability)
1. §2 seam re-stated as **harness emits neutral events / track-adapter ingests** — harness core never depends on track; no harness→track call; no circular dep. 2. §3 multi-level status = **computed projection over linked Items**; WP/hierarchy stays derived (track v2 for first-class). 3. §5 graphify-KM = **retrieval/index only**; track stores decisions, KM indexes/queries; VOL-non-goal-lift demoted to a question for graphify's owner. 4. Added `VerificationRun` + `CompoundSignal` v0 schemas. 5. §7 BR-42h **inherits the D5/D6 (lib) vs D7 (publish) split** and is marked **proposed, not yet in `plan/42`/`PLAN.md`**; single owner for the compound contract. 6. §8 actors named from live h2a discovery; graphify is **BR-34** (the `plan/34` stub still says BR-28 — stale, to fix); `poc-k8s` ≠ remote owner. 7. Citation fixed: supersedes ARTICULATION **§3.1 item 3** (BRANCH.md ownership), not "§3.1.3".

---

## 1. Purpose

Turn the ~15 GAPS + 7 internal overlaps from the atomic mapping into actionable proposals, assign owners, route the cross-repo ones via **h2a** — keeping in **BR25** only the harness method, building the harness CLI as **BR-42h**, and elevating **BR-42 = coordinator of all CLIs**.

**Widened 2026-06-04 (user directive):** BR-42 must also (a) federate the **WHOLE** `@sentropic` CLI roster under `stp` (cross-repo — see §11.1), (b) **harmonize the verb vocabulary** across CLIs so per-CLI subcommands can be promoted to top-level verbs — e.g. `stp track report` → `stp report` (§11.2, BR-42i), and (c) ship an **à-la-carte + lazy-skill / conflict-avoidance mode** so a repo adopts sentropic capabilities selectively, coexists with foreign ecosystems (e.g. `superpowers`), and loads skills on demand to cut token cost (§12, BR-42k). These run **in parallel to the app-builder (BR-42a)** under the BR-42 umbrella (§13).

---

## 2. Seam — harness emits, track ingests (track stays OPTIONAL for the engine)

**Correction of the draft (both reviewers, HIGH).** The articulation spec's firewall holds: harness is the neutral emitter; track ingests. We do NOT reverse it. The user intent ("track-rigor when present; degraded BRANCH.md otherwise; in-fine track-imperative") is met **without** a harness→track dependency:

- harness emits **neutral events** — `VerificationRun` (verify results) **and** `WorkEvent` (decision-made, lot/task-status-changed). It writes them to its own neutral output (BRANCH.md + a neutral JSON stream). harness **never calls into track**, never imports track's model.
- A **track-side adapter** (`stp track ingest`, owned by track) consumes the neutral stream → typed Items/Decisions/acceptance/`.track/*.jsonl`.
- **Engine = track-optional** (preserves `SPEC_VOL_HARNESS.md:7` "adoptable sans notre stack"). **`sentropic` profile = requires the track adapter be wired** (de-facto track-rigor for us). "in-fine track-imperative" = a profile policy, not an engine dependency. **No circular dep**: arrows point harness→neutral-output→track only.
- **Decision/WP recording is a *profile* capability, not an *engine* capability** — the bare engine degrades to BRANCH.md checkboxes; the `sentropic` profile gets first-class decisions/tasks via track.
- BRANCH.md = human surface + degraded local store; track = system of record when its adapter ingests.

### 2.1 `VerificationRun` v0 (neutral artifact — shared with track-ingest; freeze at plan gate)
`{ schemaVersion, runId, commit, branch, env, runner, category: static|unit|integration|e2e|ci|uat|security, command, result: pass|fail, startedAt, finishedAt, checks[], violations[], artifacts[] }` — superset of track's `TestRun{commit,env,runner,result,at}` (`../track/INTENTION.md:89-91`).

### 2.2 `WorkEvent` v0 (neutral decision/task event — emitted by harness, mapped to Items by the track adapter; freeze at plan gate)
`{ schemaVersion, eventId, kind: decision-made|lot-status|task-status|branch-status, level?: spec|plan|wp|lot|task, ref, status?: to-do|in-progress|done|awaited|dropped, payload, at }` — the track adapter maps these to Items/Decisions and `status(level)` rolls them up (§3). harness never writes track's store; it only emits this neutral stream (alongside `VerificationRun`). This is the artifact the **track** P0 ingest ask (§8) commits to consume — its shape must be frozen with the track owner before the seam is locked.

---

## 3. Multi-level status — a computed projection over linked Items (track stays lean)

**Correction (both reviewers, HIGH/MED).** The draft promoted `WorkPackage` to first-class + a typed spec→plan→WP→lot→task hierarchy into track core — which contradicts track's round-3 **Validated (keep)**: "WorkPackage **DEGRADED to a derived view — not stored**" and "lean agile projection **out of core**" (`../track/INTENTION.md:18,123,209`). track's Item model can *link* hierarchy (`parent`/`links`, `../track/src/model/item.ts:7,34`) but does not *type* the levels; the importer creates only feature+lot chores (`../track/src/track.ts:413`).

Corrected proposal:
- **`status(level)` = a computed projection** over linked Items (using existing `parent`/`links`), NOT a stored first-class WP. Levels `spec | plan | wp(branch) | lot | task` are *views*, computed by roll-up of child Item statuses (to-do/in-progress/done/**awaited**/dropped + acceptance).
- This delivers "progress of each WP per branch/lot" without un-deciding track's MVP. **First-class WP/level typing → deferred to a track v2 model decision (track owner).**
- harness `lot-gate`/`branch-close` emit `WorkEvent`s (§2); the track adapter maps them to Items; `status(level)` rolls them up.

---

## 4. Security / architecture / data → harness verify-hooks (+ track for decisions) (COMPLETE harness)

Enforcement = harness verify-hook plugins (profile data); decisions/debt = track:

| Domaine | harness verify-hook plugin | track |
|---|---|---|
| Security debt | `security`: Semgrep + Trivy SCA + `npm audit` + secret-scan → vuln-register | Item `chore/security` + Decision (waiver/mitigation) |
| Architecture | `boundaries`: inter-package import rules (`rules/architecture.md` + ARCH_BOUNDARIES) | architecture Decision (ADR) |
| Data model | `schema`: drizzle ↔ `DATA_MODEL.md` sync + "1 migration max" | migration Decision |
| Contracts/API | `contract-diff`: OpenAPI/wire diff vs published | breaking-change Decision |

Converges ~10 mapping GAPs onto one mechanism (the verify-hook SPI). Checks are profile data.

---

## 5. graphify → knowledge-manager (retrieval/index only) + agent-stats = answer to hermes

hermes compared to **graphify** (not h2a): hermes = persistent memory + auto-skill-from-history + autonomy, but **no signed provenance/audit** (`../agent-stats` draft fact). Our edge = h2a signing.

**Correction (both reviewers, HIGH).** graphify-KM must NOT become a competing decision store (track is the system of record) and must NOT silently lift a *confirmed* VOL non-goal:
- **graphify-KM = retrieval/index ONLY**: it *indexes and queries* code/docs/specs/**track-stored decisions**/incidents — it never *stores* decisions (track does). No duplicate authority (`SPEC_STUDY_HARNESS_WORKFLOW_ARTICULATION.md` double-employment firewall).
- The VOL evolution (`SPEC_VOL_GRAPHIFY.md:11` "reste dev/exploration / pas d'absorption") is an **amendment → a question for graphify's owner** (B3), not a study fiat.
- **agent-stats** (`@sentropic/agent-stats`, real CLI: sessions/cost/**anomalies**) → emits a typed **`CompoundSignal`** feed to the harness `compound` ritual.
- Pipeline owner: **one accountable contract owner** for the compound pipeline (proposed: harness owns the `compound` ritual contract; graphify-KM + agent-stats are sources; h2a signs).

### 5.1 `CompoundSignal` v0 (agent-stats → compound ritual; freeze with owners)
`{ schemaVersion, signalId, kind: recurring-error|frustration|anomaly|usage-pattern, evidence[], firstSeen, lastSeen, count, suggestedArtifact: rule|skill|incident, refs[] }`

---

## 6. Per-CLI proposals (ADD / MODIFY)

| CLI | Action | What | Depends on | Prio |
|---|---|---|---|---|
| **harness** | ADD | neutral `WorkEvent`/`VerificationRun` emitters + `BranchMdAdapter` (degraded); track adapter is **track-owned** | — (track optional) | **P0** |
| **harness** | ADD | verify-hook plugins `security`/`boundaries`/`schema`/`contract-diff` | sentropic profile | P1 |
| **harness** | ADD | `compound` ritual (contract owner) consuming graphify-KM + agent-stats `CompoundSignal` | graphify-KM, agent-stats | P1 |
| **harness** | MODIFY | `report` = work-in-flight only; status roll-up read from track projection | track (optional) | P0 |
| **track** | ADD | `ingest` adapter (consume harness neutral stream) + `status(level)` **computed projection** | — | **P0** |
| **track** | DEFER | first-class WP/level typing → track v2 (not MVP) | — | v2 |
| **graphify** | MODIFY | evolve into **knowledge-manager (retrieval/index only)**; index track decisions, never store | track (read) | P1 |
| **agent-stats** | ADD | emit `CompoundSignal` feed | graphify-KM/harness | P2 |
| **h2a** | ROLE | sign compound-notes/decisions (provenance vs hermes) | — | P2 |
| **DS-cli** | ADD | a11y lint rule + (option) borrow impeccable "slop-detection" | — | P2 |
| **remote** | ROLE | session secrets/credentials owner + deploy target | — | P2 |
| **stp** | ADD | federate all `@sentropic/*-cli` (plugin-discovery) — **BR-42-coordinator-owned** | all | P1 |

---

## 7. Partition — BR25 / BR-42 / dispatched

### 7.1 Stays in **BR25** + successor **BR-42h**
- **BR25** (PR #161): the harness METHOD (C1–C10, best-of-breed, the `sentropic` profile rule-pack). Docs-only.
- **BR-42h (proposed — NOT yet registered in `plan/42`/`PLAN.md`)**: the `@sentropic/harness` CLI build. **Must inherit the articulation gating split**: the **core lib** (neutral event emitters, scope/branch/lot/verify, profile) starts after **D5/D6**; **publish + `stp harness` registration** gate on **D7** (`SPEC_STUDY_HARNESS_WORKFLOW_ARTICULATION.md:143,152`). Do NOT collapse the split into one lot.

### 7.2 **BR-42 = coordinator of all CLIs**
- Rationale: BR-42 owns `@sentropic/cli`/`stp` + `build-cli`/`stp app`. **Caveat**: `plan/42` currently frames BR-42 as **documentation-only** ("No code", `plan/42:8`) covering build-app/modules (a..g), **not yet "all CLIs"**. → **Action: amend `plan/42`/`PLAN.md`** to (a) register BR-42h as the first *code* lot, (b) widen the umbrella to CLI-federation coordination. Until amended, BR-42h is **proposed**, not registered. Optional BR-42i (stp federation) / BR-42j (compound pipeline) at the BR-42 plan gate.

### 7.3 **Dispatched to other actors** (see §8 for live h2a addresses)
track · graphify · agent-stats · h2a · remote · DS.

---

## 8. h2a dispatch packets (live actors from discovery 2026-06-03)

Lightweight informational handoffs (inbox), each pointing to this spec §, asking for review/feedback — **not** binding negotiations. Sent only after user go-ahead (outward broadcast to live peers).

| → Actor | h2a instance (live) | Ask | § | Note |
|---|---|---|---|---|
| **track** | `claude:track:238a89077319` 🟢 | Own the **`ingest` adapter** + **`status(level)` computed projection**; confirm you stay lean (WP first-class = your v2 call). harness will emit neutral events you ingest — **no reverse dependency**. | §2,§3 | P0 — the load-bearing seam |
| **graphify** | `claude:graphify:c97273b702e1` 🟢 | Evolve into a **knowledge-manager (retrieval/index only)**; index track-stored decisions, never re-store. This **amends `SPEC_VOL_GRAPHIFY.md:11`** — your decision. Fix the stale **BR-28→BR-34** label in `plan/34`. | §5 | B3 amendment |
| **h2a** | `claude:a2a-cli:07bcd1936752` 🟢 | Provide **signing** for compound-notes/decisions (provenance vs hermes); confirm blockage `raise/resolve` reuse; NHI for harness agents. | §5,§6 | P2 |
| **remote** | `claude:remote:dd4ce27f32be` 🟢 | Own **session secrets/credentials** + deploy target; define the harness↔remote workspace seam. (`poc-k8s` = cluster-op dep, not you.) | §6 | P2 |
| **DS** | `claude:sent-tech-design-system:44b4e5a8` 🟢 | Add an **a11y lint rule** to `@sentropic/design-system-skills`; evaluate borrowing impeccable's **slop-detection**. | §6 | P2 |
| **agent-stats** | *(no h2a instance)* | Emit a **`CompoundSignal`** feed for the compound ritual. **Owner = rhanka; not on h2a → out-of-band ask.** | §5.1 | owner TBD |
| BR-42 coordinator | `claude:sentropic` (us) | Amend `plan/42`/`PLAN.md`: register BR-42h, widen to CLI-federation. | §7 | internal |

---

## 9. Decisions ledger

### 9.1 Reversible (decided; user-directed, review-corrected)
- **R1** — harness **emits neutral events**; track **ingests via its own adapter**. Engine track-optional; `sentropic` profile track-required. No harness→track dependency, no circular dep. *(corrected per review)*
- **R2** — sec/archi/data = harness verify-hook plugins; decisions = track.
- **R3 (architecture constraint, decided)** — graphify-KM is **retrieval/index only** (track is the *sole* decision store); the compound ritual is signed by h2a. *(Owner-pending, see §9.2: graphify adopting the KM role = B3; agent-stats building the `CompoundSignal` feed = B5. These are owner calls, not decided here.)*
- **R4** — iii ignored (product, no method-CLI).
- **R5** — BR-42 = coordinator of all CLIs (user-directed); BR25 successor = **BR-42h** (proposed; `plan/42`/`PLAN.md` amendment + lot letter pending → B4), inheriting the D5/D6-vs-D7 split.

### 9.2 Blocking / to confirm (dispatched to owners)
- **B1** — track: ship `status(level)` as a **computed projection now**; first-class WP/hierarchy = **track v2** decision. → track owner.
- **B2** — track-dependency cadence: engine-optional / sentropic-profile-required / hard-in-fine. Reco as R1.
- **B3** — graphify-KM = VOL amendment (lift dev/exploration-only). → graphify owner.
- **B4** — BR-42h lot letter + `plan/42`/`PLAN.md` amendment (register BR-42h, widen umbrella). *(durable name → user validation)*.
- **B5** — compound pipeline single contract owner (proposed: harness owns the ritual contract).

---

## 10. Open questions (plan gate)
1. `VerificationRun` (§2.1) + `WorkEvent` (§2.2) + `CompoundSignal` (§5.1) schema freeze with track/agent-stats owners.
2. Where the `sentropic` profile lives (inside harness vs `@sentropic/harness-profile-sentropic`).
3. graphify-KM ↔ track decision-index boundary (store vs index) — confirm with both owners.
4. The shared embeddable-view contract (track/h2a/graphify/sentropic screens) — coordinate-level, out of scope here.
5. Bare-verb ownership + collision policy for `stp <verb>` harmonization (§11.2) — which CLI owns `report`/`status`/`init`/`verify` as a top-level verb; how fan-in vs single-owner resolves.
6. À-la-carte manifest location/shape + the lazy-skill loading mechanism (thin index in context + on-trigger body fetch) (§12).

---

## 11. `stp` federation roster + vocabulary harmonization (BR-42 coordinator, user-directed 2026-06-04)

**User directive (2026-06-04):** `stp` must federate the WHOLE `@sentropic` CLI ecosystem (cross-repo, plugin-discovery), and BR-42 must **pilot all the CLIs to harmonize the verb vocabulary** so a per-CLI subcommand can be promoted to a top-level verb — e.g. `stp track report` → `stp report`.

### 11.1 Federation roster (all federated under `stp`, cross-repo)
| Subcommand | Package / repo | Role | Status |
|---|---|---|---|
| `stp app` | `@sentropic/build-cli` (this repo) | app scaffolder/builder | shipped (BR-42a1) |
| `stp h2a` | `@sentropic/h2a` (rhanka/h2a) | agent-to-agent trust/coordination | live CLI |
| `stp knowledge` (ex-`graphify`) | `@sentropic/graphify` → knowledge-manager | retrieval/index (KM) only | rename pending (B3) |
| `stp remote` | `sentropic-remote` (rhanka/remote) | session secrets + remote/dev + deploy target | live CLI |
| `stp track` | track (rhanka/track) | acceptance/realization, decisions, status | live CLI |
| `stp design` | `@sentropic/design-system-*` / `-skills` | DS lint / a11y / tokens (skill `sent-tech-design`) | live |
| `stp harness` | `@sentropic/harness` (BR-42h) | code-work/PR-workflow method layer | proposed (gated D7) |
| `stp agent-stats` | `@sentropic/agent-stats` (rhanka/agent-stats) | session telemetry / anomalies → `CompoundSignal` | live CLI, no h2a instance |

`stp` itself = `@sentropic/cli` umbrella (`registerSubcommand` seam, plugin-discovery). Federation is **lean dispatch**: each `@sentropic/*-cli` self-registers; `stp` does NOT vendor them. Cross-repo → `stp` discovers installed sibling CLIs at runtime.

### 11.2 Vocabulary harmonization (`stp <verb>`)
- BR-42 coordinator owns a **shared verb namespace** across federated CLIs so common verbs (`report`, `status`, `init`, `verify`, …) can be invoked as `stp <verb>` and dispatched to the owning CLI(s) — e.g. `stp report` ≡ `stp track report` (and may *fan-in* across CLIs that expose `report`).
- Requires a **verb registry + conflict policy** (which CLI owns a bare verb; how collisions resolve; the explicit `stp <cli> <verb>` form always works as the unambiguous escape hatch).
- Harmonize naming **BEFORE** the CLIs proliferate (cheaper now). Promotion/aliasing is coordinator-owned, not per-CLI fiat.
- New proposed lot **BR-42i (stp federation + verb-harmonization)** — registers the roster + the verb registry/aliasing + the conflict policy.

## 12. Conflict-avoidance & lazy-skill mode (à-la-carte, token-economical) (user-directed 2026-06-04)

**User directive (2026-06-04):** provide a **mode/skill to reduce conflicts with other CLI/skill ecosystems** (e.g. `superpowers`) so a repo can adopt sentropic capabilities **à la carte**, and **optimize token usage by loading skills on demand** (not all upfront).

### 12.1 Problem
The sentropic skill/CLI surface coexists with foreign skill providers (superpowers, plugin skills, etc.). Trigger-name / slash-command / skill-name collisions + always-loaded skill bodies = both UX conflicts AND token bloat (every skill description loaded each session).

### 12.2 Direction (to design)
- **À-la-carte capability strategy (per-repo):** a manifest (e.g. `.sentropic/stp.toml` or settings) where a repo opts INTO a subset of sentropic CLIs/skills, and can namespace/disable ones that collide with its other tooling. Default = minimal; opt-in widens.
- **Lazy / on-demand skill loading:** load a skill's full body only when triggered (keep a thin index in context), minimizing the per-session token footprint — same principle as the catalog's `search_*`-first + on-demand fetch (BR-42b) and the harness deferred-tool `ToolSearch`. Reuse that pattern for skills.
- **Conflict policy:** namespacing (the `stp …` prefix isolates sentropic verbs from foreign slash-commands), explicit precedence rules, and a "quiet mode" that suppresses sentropic auto-triggers when a foreign ecosystem owns the surface.
- New proposed lot **BR-42k (stp à-la-carte + lazy-skill/conflict mode)**.

### 12.3 Relationship to BR-42b catalog (the substrate)
The catalog's `CatalogSource` + `search_catalog` (on-demand, kind-tagged discovery; MERGED) is the **mechanical substrate** for lazy capability loading — skills/tools/agents/workflows are catalog entries resolved on demand. **BR-42k = the policy/mode layer** (à-la-carte selection + conflict avoidance + token budget) ON TOP of that substrate. BR-42b directly enables BR-42k.

## 13. Plan registration (amends §7) — BR-42 sibling lots, parallel to BR-42a app-builder
Under the BR-42 = CLI-ecosystem coordinator umbrella (amend `plan/42`/`PLAN.md` accordingly):
- **BR-42a** — app-builder (`stp app`, `@sentropic/build-cli`) — **DONE/shipped**.
- **BR-42b** — unified capability catalog (5 kinds + `search_catalog`) — **MERGED** (PR #247); the substrate BR-42i/k consume.
- **BR-42h** — `@sentropic/harness` build (gated D5/D6 lib, D7 publish + `stp harness` register).
- **BR-42i** — `stp` federation roster + verb-harmonization (vocabulary; §11).
- **BR-42k** — `stp` à-la-carte + lazy-skill / conflict-avoidance mode (§12).
All four (h/i/k beyond the shipped a/b) are **siblings runnable in parallel to the app-builder**. Durable lot letters + names → user validation (cf. no-unvalidated-naming).

### Ledger additions (extend §9)
- **R6 (2026-06-04, user)** — `stp` federates the full roster (§11.1); BR-42 coordinator harmonizes the verb vocabulary (`stp track report`→`stp report`) via a verb registry + conflict policy (**BR-42i**).
- **R7 (2026-06-04, user)** — ship an à-la-carte + lazy-skill / conflict-avoidance mode (**BR-42k**) reusing the catalog on-demand substrate (BR-42b); coexist with foreign ecosystems (superpowers) + cut token footprint.
- **B6** — bare-verb ownership + collision policy (which CLI owns `report`/`status`/… as `stp <verb>`). → BR-42 coordinator.
- **B7** — à-la-carte manifest location/shape + lazy-skill-loading mechanism (index-in-context + on-trigger body fetch). → BR-42 coordinator + harness/skills owners.
