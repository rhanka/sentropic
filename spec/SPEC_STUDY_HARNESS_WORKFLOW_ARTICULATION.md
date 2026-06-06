# SPEC STUDY — Harness as the code-workflow layer: articulation with track / stp / h2a / remote, and positioning vs compound-engineering

Status: **Scoping / brainstorm (planning-only)**. No code, no branch, no worktree produced by this document. Output of read-only analysis on `main`/`uat/39c-auth-oidc` HEAD, 2026-06-03. Decision-oriented: the load-bearing section is **§6 Decisions ledger**.

Lineage: extends **BR25** (`chore/rules-skills-audit`, PR #161 OPEN — best-of-breed agent-method study + C1–C10 mechanical-enforcement candidates). Pins the "in fine" deliverable of the BR25 line and its seams. Consumes `spec/SPEC_VOL_HARNESS.md` (BR23-origin **draft intention, not yet confirmed**), `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md` §6/§11/§13/§461, `spec/SPEC_EVOL_BUILD_APP_CLI.md` §D1 (meta-CLI `stp` ratification) + §3.1 (harness↔build-cli boundary), `../track/INTENTION.md` (system-of-record boundary).

## Review log

- **2026-06-03 (draft)** — Initial draft after a double co-brainstorm (**Codex 5.5-xhigh** + **Opus 4.8**, brief `.tmp/br25-cobrainstorm-brief.md`). The two tiers converged on the shape (lib-first, `make→stp→lib`, track seam, borrow-from-everyinc) and diverged on one point — package boundary — resolved here.
- **2026-06-03 (this revision)** — Hardened after a **double adversarial review** of the draft (Codex + Opus, brief `.tmp/br25-review-brief.md`, raw outputs archived). Folded 12 consensus corrections (A–L below) and 2 user decisions: **(1)** harness home = monorepo `packages/harness` (extraction seam kept); **(2)** engine = **TS library as source of truth**, with its own `harness` CLI + cross-host plugins (Claude/Codex/Gemini/Aider/…) + a `stp harness` federated subcommand — like `@sentropic/graphify`; this **supersedes** the shell-first slicing of `SPEC_STUDY_BR25_ENFORCEMENT_PLAN.md`. Subcommand `stp harness` is a user-selected extension consistent with D1 (not ratified by D1). everyinc anchor = method/product split (no new `STRATEGY.md`).
- **2026-06-03 (2nd-pass critical re-read)** — re-read of the revised doc by Codex 5.5-xhigh + Opus 4.8 (brief `.tmp/br25-rereview-brief.md`). Fidelity of A–L + the 2 decisions confirmed; applied their consolidated must-fixes: track-ingest strictly track-owned (no in-harness plugin); `VerificationRun` schema sketched + freeze flagged; githooks call a `make` target (no host Node); §7.1 closing gate clarified (D1–D7 ratifies the study, D5/D6 unblocks the lib branch); build-cli seam reworded to a *future* templating-engine consumption; BR25 source paths qualified as branch-local; extraction-seam invariants made testable; citation/quote fixes.

### Corrections applied from the double review (traceability)
A. `acceptance.run` direction inverted (harness emits neutral artifact; track ingests). B. Gating split D5/D6 (internal lib) vs D7 (publish). C. `stp harness` = user extension consistent with D1, not D1-ratified. D. harness↔build-cli shared seam = templating/scaffold engine, **not** verify-SPI; build-cli does not block on harness. E/F. everyinc figures marked external-unverified; `SPEC_VOL_HARNESS` marked unconfirmed draft. G. `sentropic` profile = isolated rule-pack **module** (code+data) behind a profile API, proven by a 2nd stub profile. H. method-anchor (`rules/MASTER.md`) vs product-anchor (`PLAN.md`/`SPEC_VOL_*`/track dossiers) split. I. jargon disambiguation vs `SPEC_EVOL_DEV_PLAYWRIGHT_HARNESS.md`. J. `stp harness graph` blocked on `@sentropic/graphify` fusion. K. explicit `BRANCH.md`-state vs track realization/acceptance conflict rule. L. everyinc "borrow" count corrected.

---

## 1. The question & the verdict

**Question (user, 2026-06-03):** *In fine*, does the BR25 line yield a **dedicated sub-CLI + library** exposing a sub-scope of our features oriented to the "code work / PR steps / CI-CD" workflow? How does it articulate with the parallel workstreams `track`, `h2a`, `remote`, and the **main meta-CLI** (`@sentropic/cli`, binary `stp`)? Incorporate the learnings of `everyinc/compound-engineering-plugin`.

**Verdict — YES. The deliverable is `@sentropic/harness`** (a TS library + its own `harness` CLI + cross-host plugins + a `stp harness` federated subcommand). `spec/SPEC_VOL_HARNESS.md` already sketches this identity — *"un outil **neutre** de scaffolding / conductor / verify pour AI dev — branch discipline, BRANCH.md templates, plan/spec templates, verify hooks, conductor CLI — importable depuis tout repo tiers via npm + CLI binary `harness`, sans dépendance runtime sur l'app Sentropic"* — **but note that VOL is a draft intention ("Intention to be confirmed before SPEC_EVOL translation", `SPEC_VOL_HARNESS.md:3`), not a ratified contract.** This study confirms and operationalises that intention.

Division of labour:
- **BR25 (`rules-skills-audit`)** = the *study* defining **WHAT** the workflow layer enforces (best-of-breed synthesis + C1–C10, `tmp/chore-rules-skills-audit/spec/SPEC_STUDY_BR25_ENFORCEMENT_CANDIDATES.md` — BR25 deliverable specs live in the branch worktree until PR #161 merges).
- **`@sentropic/harness`** = the *package* implementing it (planned; `ARCH_BOUNDARIES` §6/§461).
- **This spec** = the *articulation* pinning harness as the workflow layer and its seams.

**Framing correction (both tiers):** do not narrow this to "CI-CD". The core is *code-work execution discipline* — branch/worktree → `BRANCH.md` scaffold → scope checks → lot gates → verify hooks → commit/PR readiness → CI/UAT handoff → report. "CI-CD" is one facet (the `merge-check` gate + the verification-result bridge to track), not the whole.

---

## 2. The resolved fork — harness IS the workflow layer (not a separate `@sentropic/work`)

The two tiers diverged on one point:
- **Opus 4.8:** a *separate* `@sentropic/work` consuming a generic harness ("socket" vs "bulb"), to protect harness's neutrality.
- **Codex 5.5-xhigh:** the workflow layer **IS** `@sentropic/harness` (+ a thin CLI).

**Resolution → harness IS the layer (Codex's shape), with Opus's discipline kept as an internal module boundary.** Both reviewers, re-judging adversarially, **uphold this** — but for a sharper reason than "the specs settle it" (correction E/F: `SPEC_VOL_HARNESS` is an unconfirmed draft, so it does not "settle" anything):

> A separate `@sentropic/work` would have **no second consumer today** (YAGNI) and would face the **identical leakage question** — the Sentropic policy must live *somewhere*; a second npm boundary does not make the 150-LOC limit / `BRANCH.md` grammar / make-only / `ENV=dev` guard any less Sentropic-specific. The right boundary is **engine vs profile**, which can live in one package and lift out *iff* a real second profile appears.

**Hardened position on the profile (correction G):** the `sentropic` profile is **not mere config data** — both reviewers stressed this. The 150-LOC threshold and the `ENV=dev` guard are parameters, but the `BRANCH.md` template grammar (C5: no `###`, checkbox-only, against `plan/BRANCH_TEMPLATE.md`) and the make-only assumption (C3/C4) encode a **methodology**. Therefore the profile is an **isolated rule-pack module** (code + data) behind an explicit **profile API / subpath**, not a settings file. Genericity is proven, not asserted: the plan gate requires the engine to pass golden tests against a **second, trivial stub profile** (swap template grammar, command runner, env policy, commit-size threshold). With that, harness-is-the-layer holds and the leakage risk is contained to the profile module — exactly where it belongs.

---

## 3. Articulation map (final)

| Layer | Surface | Owns (sole responsibility) | Delegates | Seam to neighbours |
|---|---|---|---|---|
| **track** | `@sentropic/track`, `stp track` | **WHAT/WHY record**: typed `Item`/`Decision`/`Blocker`/`AcceptanceCriterion`/`PriorityAssessment`; append-only `.track/*.jsonl`; computed `report` | execution (engagementRef/taskRef); coordination (→ h2a); process rituals (→ harness) | **reads & ingests harness's output; annotates, never mutates `BRANCH.md`** (`INTENTION.md` §150/§197); track is the index *over* harness's master file |
| **harness** | `@sentropic/harness` (lib + `harness` bin), **`stp harness`** | **HOW record + enforcement**: `BRANCH.md` (master) + template/shape, worktree/port/env conventions, scope parser, lot-gate runner, **C1–C10** checks, verify-hook plugin SPI, report builder, branch lifecycle (init→lot→close) | generic project scaffold/templating substrate (the seam build-cli shares — §3.2); backlog/acceptance semantics → track; trust/signature → h2a; remote execution → remote | **emits a neutral `VerificationRun` JSON** (not track-shaped events); track/adapter ingests it (§3.1). Never touches product runtime. peerDep `@sentropic/graphify` only |
| **stp** | `@sentropic/cli`, binary `stp` (alias `sentropic`) | **federation only**: subcommand discovery + dispatch (`SPEC_EVOL_BUILD_APP_CLI.md` §D1) | every domain to its `@sentropic/*-cli` | dispatch mechanism (table vs plugin-discovery) **not yet ratified** (D1 "leans plugin discovery, decided at plan gate"); `stp harness` self-registers like `stp app`/`stp track` |
| **h2a** | `rhanka/h2a` (`claude:a2a-cli`) | coordination/identity/signed journal/negotiation/B2B2B trust (EVO-9) | branch mechanics → harness; product backlog → track | optional sidecar; harness may post launch-packet handoffs/blockers, never parses branch scope. **Trust stays in h2a — harness never models VALEUR/CONFIANCE** |
| **remote** | `rhanka/remote`, `stp remote` | control-plane: k8s sessions, workspaces, sync, locks, terminal/browser runtime | code-work method → harness | launches a workspace where `stp harness` runs; **infrastructure, not method** |

### 3.1 Overlap resolutions (explicit — no double-employment)

1. **verify-hooks vs lot-gate vs track acceptance** — three distinct things:
   - harness's **verify-hook SPI** = the generic *socket* ("run a typecheck/lint/test plugin").
   - **`lot-gate`** (harness `sentropic` profile) = the *policy* wired into that socket and the actor that **mutates `BRANCH.md` checkboxes**.
   - track's **acceptance** = the *revocable record* of green-ness now — a derived view, **not** a gate (`INTENTION.md` §93).
   - **Flow of truth (direction corrected, A):** `stp harness lot-gate` runs checks → writes a **neutral `VerificationRun` JSON artifact** — minimal shape `{ schemaVersion, runId, commit, branch, env, runner, category, command, result: pass|fail, startedAt, finishedAt, checks[], violations[], artifacts[] }`, a superset of track's `TestRun{ commit, env, runner, result, at }` (`INTENTION.md:89-91`); the final schema is frozen at the plan gate (§9). harness does **not** know the word "acceptance" and does **not** write `.track/*.jsonl`. A **track-side adapter** (`stp track ingest` or an optional plugin) reads the artifact and derives `acceptance.run` into track's log. This keeps harness neutral and **does not pre-empt** track's still-open CI→`acceptance.run` bridge (`INTENTION.md` §203). Dependency direction: **track → harness output**, never harness → track.
2. **branch-scaffolding: harness *project* preset vs harness `branch-init` vs track `Item`** — project-skeleton (3 presets) ≠ branch-worktree (`branch-init`: worktree + `BRANCH.md` + ports) ≠ backlog-intent (track `Item`). No overlap.
3. **`BRANCH.md` ownership + conflict rule (K):** harness owns `BRANCH.md` as master (lot-gate mutates checkboxes; branch-close consumes the body). track annotates via its sidecar only (`INTENTION.md` §197). **Explicit conflict rule** (the reviewers' catch — track *also* owns realization/acceptance/report state, `INTENTION.md` §80-93, and the DONE policy is open, §203-204): on any divergence between a `BRANCH.md` checkbox state and a track realization/acceptance value, **`BRANCH.md` is authoritative for *lot/checkbox* state; track is authoritative for *acceptance* (test-green) and *realization* (high-level done/cancelled)**; the two are reconciled by harness's `VerificationRun` artifact (the single shared fact), never by mutual writes. The `report` DONE policy (does merge-readiness require track acceptance `pass`, or `BRANCH.md` lot completion alone?) is deferred to the plan gate (§9).

### 3.2 harness ↔ build-cli seam (correction D)

The ratified `SPEC_EVOL_BUILD_APP_CLI.md` §3.1 / BR42a-A decided that **`@sentropic/build-cli` is a separate package designed to *later consume* harness's templating engine when/if harness ships it — and that harness must not be bloated with the scaffolder**; for the MVP build-cli carries its **own minimal templating substrate** and **does not depend on or block on harness** (`:127,:129,:247`). Therefore the genuine shared seam is the **generic templating / scaffold-manifest engine** (which build-cli prototypes and harness later adopts/absorbs, additively) — **not** the verify-hook SPI. The verify-hook SPI is harness-internal, with its `sentropic` profile as first consumer; a second consumer for the *templating* engine (build-cli) exists, satisfying the contract-consumer co-design rule for *that* engine. (Earlier draft wrongly cast build-cli as the verify-SPI's 2nd consumer.)

---

## 4. Proposed surface (user-decided shape)

**Pattern = `@sentropic/graphify`** (lib + `graphify` bin + cross-CLI skill format + `stp graphify`). harness mirrors it: **one TS library as source of truth**, four faces.

### 4.1 The faces (engine = TS lib, supersedes BR25 shell-first plan)

- **Library (host-agnostic core, source of truth):** `@sentropic/harness` — TypeScript, Node built-ins, **zero product-stack coupling, zero `make` coupling in the core**. Programmatic API: `parseBranchMd()`, `checkBranch()`, `checkScope()`, `checkBranchMdShape()`, `checkCommitSize()`, `checkUatState()`, `checkTestEnv()`, `initBranch()`, `lotGate()`, `closeBranch()`, `renderReport()`, `emitVerificationRun()`. Each returns `{ pass, violations[], bypass? }`. **C1–C10 live here once** → identical behaviour in Claude Code, Codex, bare shell, CI, remote pod. The `sentropic` rule-pack is a **profile module** behind a profile API (§2/G).
- **Standalone `harness` CLI:** the package ships a `harness` binary for third-party repos (no `stp` needed).
- **Cross-host plugins/skills:** Claude / Codex / Gemini / Aider / OpenCode (cross-CLI skill format, like graphify), packaged per-host via the **`install-skills --host`** mechanism reused from h2a (`../track/INTENTION.md:167`). Today's `.claude/skills/{branch-init,scope-check,lot-gate,branch-close,post-branch-update,launch-agent}` (Claude-only) are regenerated as thin shims invoking `harness`/`stp harness`. One contract → no per-host drift.
- **`stp harness` federated subcommand:** `@sentropic/cli` discovers and federates it (like `stp graphify`). User-selected, consistent with D1; the dispatch mechanism (table vs plugin-discovery) is decided at the plan gate.

**Engine architecture decision (supersedes shell-first):** the TS lib is the single source of truth. In-repo, `rules/MASTER.md` make-only/Docker-first is honoured by **`make → stp harness → lib`** passthroughs; **githooks are thin POSIX shims that call a `make` target** (`.githooks/pre-commit` → `make <check> ENV=…` → Docker → lib), **not** `node`/`stp` on the host — so no host Node/npm is introduced (respects `rules/MASTER.md` Docker-first). This **supersedes** the pure-POSIX-shell *implementation* of `SPEC_STUDY_BR25_ENFORCEMENT_PLAN.md` while **keeping its advisory→blocking cadence** (only the implementation is replaced, not the layering). **Constraint to manage:** a container-per-hook adds pre-commit latency; mitigation (persistent dev container / a fast-path for the hottest checks) is a plan-gate detail (§9). CI calls `make`, not naked `stp`. Direction is strict `make → stp harness → lib` — never the reverse, never circular.

Illustrative verb surface (finalised at plan gate): `stp harness branch init|close` · `stp harness check branch|scope|branch-md|env|command|commit-size|test-env|merge` · `stp harness lot-gate --lot <n>` · `stp harness verify --category static|unit|integration|e2e|ci|uat` · `stp harness report --format markdown|json` · `stp harness skills install --host claude|codex|gemini|aider` · `stp harness graph extract|query|publish` (**blocked on `@sentropic/graphify` fusion — correction J**; absent-graphify UX = a clear "graphify not installed" error, the verb degrades, the rest of harness works).

### 4.2 Home, license, package shape (user-decided + house default)

- **Home: monorepo `packages/harness`** (user). Reuses the existing per-package CI/publish OIDC lane + `enforce-package-bump` gate. **Extraction seam (testable invariants from v1, not hand-waved):** no `import` outside `packages/harness`; package-local test fixtures; no monorepo workspace-path assumptions in the core; a `pack`/publish-dry-run check in CI — so a later lift to a standalone `rhanka/harness` repo (matching track/remote, for third-party adoption) is a move, not a rewrite.
- **CI publish-bootstrap (correction/missing-seam):** a brand-new package needs the one-shot bootstrap — add `bootstrap_publish_target=harness` to `.github/workflows/ci.yml` (absent today) + attach the OIDC trusted publisher after first publish (per `rules/workflow.md` Package Publication; same drill as BR-39/41).
- **License: MIT** (house default, matches `@sentropic/build-cli` BR42a-I and the published `@sentropic/*` family) — consistent with the "third parties adopt our method" pitch.
- **Package split:** single `@sentropic/harness` ships the lib + `harness` bin for v1; a separate `@sentropic/harness-cli` only if the `@sentropic/cli` dispatch contract mandates a `*-cli` package per domain (decided at the plan gate with the dispatch mechanism). The `sentropic` profile ships **inside** harness v1 behind the profile API (extractable to `@sentropic/harness-profile-sentropic` later if a 2nd profile materialises).

---

## 5. Positioning vs `everyinc/compound-engineering-plugin`

> **Evidence caveat (correction E/F2):** the everyinc figures below (37 skills / 51 agents, the 8-stage cycle, `STRATEGY.md`, `/ce-compound` layout, grep-first retrieval) are **external, sourced from the upstream repo (https://github.com/everyinc/compound-engineering-plugin), not verified in this repo.**

**Stance: borrow the multi-host packaging + the compound ritual (and the review-as-pattern-capture idea); differentiate the rest** (both tiers; "borrow ≈ three, not two" — correction L).

| everyinc concept | Sentropic decision |
|---|---|
| `STRATEGY.md` anchor | **DROP the new file (user).** Anchor split (correction H): **method anchor = `rules/MASTER.md`**; **product/vision anchor = `PLAN.md` + `SPEC_VOL_*` + track `Decision` dossiers** — *not* `rules/MASTER.md`. No new root file; no product north-star gap. |
| `/ce-ideate`, `/ce-brainstorm` | **DIFFERENTIATE** — recorded into a typed track orientation `Decision` + `Dossier` (`INTENTION.md` §125-132); we are stronger. |
| `/ce-plan` | **DIFFERENTIATE** — scope-bounded (Allowed/Forbidden paths) + mechanically checked. `stp harness branch init`. |
| `/ce-work` | **DIFFERENTIATE (our headline differentiator)** — worktree isolation, `ENV=` port slots, make-only, Docker-first, scope paths. `stp harness lot-gate`. |
| `/ce-debug` | **INTEROP** — covered by `systematic-debugging` skill. |
| `/ce-code-review` | **BORROW review-as-pattern-capture** — feed `/code-review` findings into the compound ritual. |
| `/ce-compound` | **STEAL the ritual** (not the file layout) — see §5.1. |
| `/ce-product-pulse` | **IGNORE (MVP)** — later `stp track pulse`, not harness. |
| 80/20 plan-review | **ALREADY DO BETTER** — double adversarial review (Codex+Opus) per design gate; could codify as `stp harness review` later. |
| Knowledge compounding | **DIFFERENTIATE** — layered memory with explicit precedence + Graphify clusters. |
| **Multi-host packaging** | **STEAL — #1 import.** `install-skills --host` → ship harness skills to every host (kills Claude-only lock-in). The lib-first design enables it. |

### 5.1 The compound ritual without `STRATEGY.md`

Import the **ritual** of `/ce-compound` (capture-while-fresh, structured, retrievable), not its layout. **`post-branch-update`** is upgraded to route each learning to the correct existing layer — durable rule → `rules/*.md` (under `rules/MASTER.md` precedence, the *method* anchor); reusable pattern → a skill; incident → an incident report **+ a Graphify node** (`ARCH_BOUNDARIES` §13). The note **references** the relevant `PLAN.md`/`SPEC_VOL_*`/track dossier (the *product* anchor) for context. everyinc's grep-first retrieval maps onto Graphify cluster/query. Surface: `stp harness report --learning` (or a later `stp harness compound`). No `docs/solutions/` tree, no new root file.

---

## 6. Decisions ledger

### 6.1 Decided (reversible or user-confirmed)

- **R1 — harness IS the workflow layer** (one package; no separate `@sentropic/work`); Sentropic policy = an **isolated profile module behind a profile API**, proven by a 2nd stub profile (§2/G).
- **R2 — Engine = TS library as source of truth** (user) with `harness` CLI + cross-host plugins + `stp harness`; **supersedes** `SPEC_STUDY_BR25_ENFORCEMENT_PLAN.md`'s shell-first slicing; githooks/make shell out to lib/CLI (Node required in dev/CI).
- **R3 — Direction `make → stp harness → lib`** (§4.1); never reverse/circular.
- **R4 — track↔harness seam (direction corrected, A/K):** harness emits a **neutral `VerificationRun` JSON**; a track-side adapter ingests → `acceptance.run`. harness owns `BRANCH.md` (lot/checkbox state); track owns acceptance + realization; conflict rule §3.1.3.
- **R5 — Enforcement cadence:** advisory-first C1/C2/C5/C7/C10; **C8 (`ENV=dev` guard) blocking immediately** (incident 2026-03-14); Layer B/C promote after one release cycle.
- **R6 — everyinc:** borrow multi-host packaging + compound ritual + review-as-pattern-capture; anchor split method (`rules/MASTER.md`) vs product (`PLAN.md`/`SPEC_VOL_*`/track); no `STRATEGY.md`; differentiate the rest.
- **R7 — Home = monorepo `packages/harness`** (user), MIT, single `@sentropic/harness` (lib + bin) v1, extraction seam kept; add `bootstrap_publish_target=harness` CI lane.
- **R8 — BR25 stays docs-only** (Allowed Paths exclude package code); the package build is a NEW branch (§7).
- **R9 — harness↔build-cli shared seam = the templating/scaffold engine, not the verify-SPI** (D); build-cli does not block on harness.

### 6.2 Resolved naming

- **B1 — Subcommand `stp harness`** (user, 2026-06-03; durable public contract). It is a **user-selected extension consistent with D1**, *not* ratified by D1 (correction C). Standalone binary `harness` (default per `ARCH §158`, still a default not a ratified name — confirm parity at plan gate). Disambiguate "workflow harness" vs the "Playwright harness" of `SPEC_EVOL_DEV_PLAYWRIGHT_HARNESS.md` in help/docs (correction I).

### 6.3 Awaiting / plan-gate gates

- **B2 — BR25 D5/D6/D7 sign-off** (`SPEC_BR25_BEST_OF_BREED.md`): **D5/D6** gate the *internal lib slice* (`feat/harness-core` may start once D5/D6 are signed); **D7** gates only *public publish + `stp harness` registration* (correction B). D1–D4 are method-adoption, not code gates.
- **B3 — `@sentropic/cli` dispatch mechanism** (table vs plugin-discovery) — D1 "leans plugin discovery, decided at plan gate"; the package-split (B-shape) follows it.
- **B4 — Profile API freeze** — co-design + prove against a 2nd stub profile before freezing (contract-consumer co-design).
- **B5 — `report` DONE policy** alignment with track (`INTENTION.md:204`): merge-readiness requires track acceptance `pass` vs `BRANCH.md` lot completion (configurable). Name the toggle.

---

## 7. Sequencing

1. **BR25 (PR #161)** closes as the **docs/method study** once its **D1–D7** decisions are signed off — i.e. ratifying the study's own recommendations (note D7 *is* the decision to defer publish, not a downstream gate the study must pass). The lib branch (step 2) needs only **D5/D6** and may start before PR #161 merges. No code in BR25.
2. **New branch `feat/harness-core`** (may start after **D5/D6**) — TS-library-first, smallest slice proving the boundary: `BRANCH.md` parser + `ScopeBoundary` model + `scope-check` (C2) + `branch-check` (C1), **golden unit tests incl. a 2nd stub profile**, `VerificationRun` JSON output, `make scope-check`/`make branch-check` rewired as passthroughs to `stp harness`, existing `.claude/skills/scope-check` left as a wrapper. (Both tiers' first slice converges here.)
3. **Follow-on branches** — remaining C-checks + lot-gate + report + verify-SPI + the track-ingest adapter; then **publish** `@sentropic/harness` (gated on **D7**) + register `stp harness` in `@sentropic/cli` + regenerate cross-host skills via `install-skills --host`. Proceeds in parallel with BR-42 (build-app/`stp app`), sharing the co-designed **templating** engine seam (§3.2).

---

## 8. Risks & anti-patterns

- **Scope creep into harness** (highest): Sentropic policy as *hardcode* rather than a swappable profile module breaks neutrality. Mitigation: R1 profile API + 2nd-stub test; peerDep `@sentropic/graphify` only.
- **Double-employment with track**: harness storing backlog/decision/priority duplicates track. Mitigation: harness records *only* `BRANCH.md` + emits a neutral `VerificationRun`; never models Items/Decisions/Priority. The §3.1 seam + conflict rule is the firewall.
- **Coupling harness→track**: emitting track-shaped events would couple a neutral tool. Mitigation: R4 — neutral artifact, track ingests (direction track→harness).
- **Two live conflicting BR25 plans**: lib-first (R2) **explicitly supersedes** the shell-first `ENFORCEMENT_PLAN.md` slicing; that plan's *layering/cadence* (advisory→blocking) is kept, its *shell-script implementation* is replaced by the lib.
- **Node-in-githook regression**: githooks now need Node; mitigate by Docker-first toolchain + a fast-path message if Node is absent.
- **Host lock-in / over-fitting to Claude Code**: today's skills are Claude-only. Mitigation: lib-first + multi-host packaging (R2/R6).
- **Premature CLI before a stable lib** (`feedback_real_reorg_not_hook_patches`): R2 lib-first prevents the shell→lib extraction trap.
- **Re-implementing Superpowers/everyinc wholesale**: harness orchestrates *branch discipline* and **delegates** ideation/TDD/debug to existing superpowers skills.
- **`stp` bypassing Make / circular**: strict `make → stp harness → lib` (R3).
- **Remote owning the method**: remote is infrastructure; the method is harness.
- **graphify not yet merged (J)**: `stp harness graph` ships only after `@sentropic/graphify` fusion; degrade gracefully meanwhile.
- **Narrowing to "CI-CD"**: loses the branch/work/verify discipline that is the point (§1).

---

## 9. Open questions for the plan gate

1. Exact `stp harness` verb taxonomy (flat `check <x>` vs grouped) — UX call.
2. Package split (single vs `+harness-cli`) — tied to `@sentropic/cli` dispatch (B3).
3. Verify-hook SPI + profile API shape — frozen only after the 2nd-stub-profile co-design (B4).
4. `report` DONE policy + the **track-ingest adapter contract — ingestion is track-owned** (`stp track ingest` subcommand or a track-owned adapter package; harness never writes `.track`), and **freeze the `VerificationRun` schema** (§3.1.1 / §4.1). (B5 / `INTENTION.md:204`).
5. Standalone `harness` binary vs `stp harness` parity tests (no verb drift).
6. h2a handoff/blocker payload contract; remote workspace assumptions; make-vs-rejected-nx relationship (the `make → stp harness` passthrough is load-bearing; disclaim against a future monorepo-tooling migration).

---

## Appendix A — Co-brainstorm & double-review confrontation (traceability)

**Co-brainstorm convergence (both tiers):** YES to a dedicated host-agnostic lib+CLI; not "CI-CD"-narrow; lib-first; `make→stp→lib`; harness owns `BRANCH.md` (track annotates via sidecar); skills→wrappers + multi-host packaging; borrow-from-everyinc + differentiate; advisory-first C1/C2/C5/C7/C10 + C8 blocking; first slice = scope-check/BRANCH.md-parser core.

**Co-brainstorm divergence:** package boundary — Opus `@sentropic/work` vs Codex harness-is-the-layer. **Resolved** → harness is the layer; Opus's neutrality discipline kept as the internal profile module (R1). Naming: Opus `stp work`, Codex `stp code` → user chose **`stp harness`**.

**Double-review consensus (both reviewers, high confidence):** invert `acceptance.run` direction (A); split gating D5/D6 vs D7 (B); `stp harness` is a user extension not D1-ratified (C); profile is a rule-pack module needing a 2nd-stub test (G); method vs product anchor split (H); graphify-blocked `graph` verb (J); jargon disambiguation (I); add CI publish-bootstrap + license + home decisions.

**Double-review divergence / unique catches:** Opus caught the **harness↔build-cli contradiction** with the ratified BUILD_APP_CLI (D — shared seam = templating, not verify-SPI) and the **everyinc-unverifiable** caveat (E); Codex pressed the **`BRANCH.md`-vs-track conflict rule** (K) and the **graphify peer-absence UX** (J). Both upheld harness-is-the-layer. All folded above. Reviewers split on home (Codex monorepo-first / Opus leaned own-repo) → **user chose monorepo `packages/harness`** with an extraction seam.
