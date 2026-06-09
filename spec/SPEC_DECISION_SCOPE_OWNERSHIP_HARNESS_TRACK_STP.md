# DECISION — Scope ownership across `harness`, `track`, and `stp`

Status: **RATIFIED 2026-06-09** (rhanka). Double-reviewed and converged: Opus 4.8 max +
Codex 5.5-xhigh (both `codex exec` read-only review + an Opus subagent review). Surfaced by
the BR-42h `@sentropic/harness` pre-UAT: a real Claude agent with no repo directive reached
for `track` to answer "am I in scope?", while with the harness directive it reached for
`harness` — i.e. two sibling tools both claim the word "scope" and an agent could not route.

## The core idea: "scope" is three different things at three layers

Keeping these separate is what makes the model coherent.

| Layer | Master | What it answers |
|---|---|---|
| **Scope DECLARATION** (the rules: path globs + WP/spec items) | **track** when present; **harness** (reads `BRANCH.md`) when track absent | "What work is authorized/expected on this branch?" — declared coarse (work-package) at task split, **refined** to spec-phase-precise scope over the branch's life. |
| **Path VERDICT** (mechanical) | **harness, always** | "Do these staged files fall inside the declared Allowed/Forbidden/Conditional globs?" Computed per-diff; **harness is the only engine and the only synchronous gate at commit time.** |
| **Realization status** | **track, always** | "Is the promised work built/accepted? what is AWAITED / DROPPED / DONE / TO-DO vs a baseline?" harness has no item-state concept. |

## Authority is LAYERED (not "track always wins")

This is the one correction both reviewers required on the initial owner phrasing
("track is master / harness is executor"):

- **Declaration authority:** track-when-present (owns the canonical scope rules, refines them
  per spec phase); **harness-when-track-absent** (falls back to reading `BRANCH.md` directly).
- **Path-verdict authority:** **harness, always** — the sole glob engine and the sole
  thing that can run/gate synchronously at commit. track (read-only) **cannot gate a commit**.
- **Realization authority:** track, always.

Metaphor: **track is the librarian (owns the rules + the long-lived record); harness is the
inspector at the door (computes and enforces the check in the moment).**

Fallbacks:
- **track absent** → harness owns scope locally; `harness check scope` is the final answer.
- **track present but stale / tampered / not-imported** → **FAIL CLOSED** (no silent
  fallback to harness-only); require import/refresh.

## Naming: keep "scope" in both; route through `stp`

The word `scope` is **shared** (renaming a correct word to dodge agent confusion is a smell;
the confusion is a routing problem, which is exactly what `stp` exists to solve):
- `harness check scope` — mechanical path verdict.
- `track scope validate` — semantic / current-phase scope validation, incl. ingested harness evidence.
- **`stp scope check` — the single command the AGENT calls.** It holds **zero glob logic of
  its own** (no third scope engine); it is a router/composer:
  1. detect track installed AND branch imported (fresh state);
  2. **track usable → track-master mode**: ask track for the active scope boundary (WP or
     refined spec-phase globs) → run harness against it → pass the `VerificationRun` back to
     track → print **one** verdict with sub-results (path pass/fail + realization status);
  3. **track absent → harness-fallback mode**: `harness check scope` on `BRANCH.md`, clearly
     labelled that realization was not validated;
  4. **track present but unsafe → fail closed.**
  Print a mode banner (track-master / harness-fallback / fail-closed) so the agent knows.

## Seam (plain language)

When the agent runs `stp scope check`, harness looks at the changed file names and the
allowed/forbidden path rules and returns JSON (a neutral `VerificationRun`): pass/fail + the
offending paths. `stp` hands that JSON to track through a **track-owned adapter**. Track does
**not** redo the file matching — it checks that its scope is current, **records the verdict as
evidence**, and folds it into the final scope report. **A path verdict never becomes a track
item-state** ("I touched allowed files" ≠ "I finished the planned work"). Direction is
one-way: harness EMITS, track INGESTS; harness never imports track. The `VerificationRun` is a
superset of track's `TestRun`; track ingests `category != static` runs as acceptance signals,
and treats `category: static` C1/C2 (branch/path) as **evidence/provenance only**, never as
item-bucket movers. (Opt-in later: track MAY infer "delivered out-of-scope" by correlating a
violation with an item — track's inference, not harness writing item-state.)

## harness as the dev-discipline skill manager

harness becomes the single front door to the dev-discipline skill layer (owner directive:
"superpowers must be fully managed by harness", plus TDD/debug/review):
- **Registry + host wrappers, not re-implementation.** A profile-data table (the existing
  `HarnessProfile` SPI) names which discipline skills are required, in what order, with what
  severity. superpowers (and per-host equivalents) are **interchangeable backends** behind it.
- Verbs: `harness discipline tdd|debug|review|verify` (+ `harness skill list/run`), each
  delegating to the backing skill and **wrapping its output into the neutral `VerificationRun`**
  (categories `unit`/`static`/… already in the taxonomy).
- **Advisory first** (BR25 D5 Layer A; exit 0), `blocking` severity reserved for later opt-in
  gating (e.g. "no commit without a TDD red-green record"); harness orchestrates ordering and
  records adherence — it does not forbid by default.
- Agent surface: *"In Sentropic worktrees, use `stp`/`harness discipline` for branch, scope,
  TDD, debug, review — do not call generic skills (superpowers) directly unless harness
  delegates to them."* harness/track/stp **supersede** generic verification on these axes.

## Risks (ranked) + mitigations

1. **"False master"** — calling track "master" while, TODAY, `BRANCH.md` + harness still make
   the real decision: track is at **0.8.0** with **no `scope` command and no `VerificationRun`
   ingest**, and `MASTER.md` still says "BRANCH.md authoritative". **Mitigation = SEQUENCE:
   do NOT flip authority in the agent docs until track has (a) declarative scope-state
   (WP→spec-phase), (b) `track scope validate`, (c) `VerificationRun` ingest.** Until then the
   live gate is harness; BRANCH.md is the source; agents are told harness-first. BRANCH.md
   becomes a projection/fallback only once track masters the declaration.
2. **Wrong command** — shared "scope" lets an agent call harness directly and skip track.
   **Mitigation: `stp scope check` is the only blessed agent command + mode banners.**
3. **`stp` grows a third scope engine** — drift across three places. **Mitigation: `stp` holds
   zero glob logic; matching exists only in harness `classifyPath`.**
4. **Skill-manager sprawl / re-coupling** — wrapping superpowers/TDD/debug could drag deps into
   the deliberately dependency-free harness. **Mitigation: skills as profile-named backends via
   thin adapters; harness keeps zero hard skill deps; output wrapped in `VerificationRun`.**

## Implementation sequence (anti-false-master)

1. (track) acquire declarative scope-state (WP→spec-phase) + `track scope validate` + ingest
   `VerificationRun`. — track owner.
2. (stp, BR-42i) `stp scope check` router (harness-fallback first; track-master once #1 lands)
   + `stp harness discipline *`. — stp owner.
3. (harness, BR-42h follow-ons) discipline-skill registry; keep emit-only; advisory.
4. (MASTER.md) state the conflict rule: BRANCH.md authoritative for lots/paths **until track
   masters the declaration**, then track for declaration+acceptance; "scope=paths(harness) /
   status=items(track)"; agents call `stp scope check`.
5. Extract a **shared `BRANCH.md` grammar** (spec + fixture) consumed by BOTH harness and track
   — both currently parse BRANCH.md independently (latent double-source-of-truth; a template
   drift silently empties one side's data, as the 0.1.1 harness parser bug showed).

## References

- `@sentropic/harness` (BR-42h): `packages/harness/**` (C1 branch-check, C2 path scope-check,
  neutral `VerificationRun`, profile-as-data SPI; advisory BR25 D5 Layer A; published 0.1.1).
- BR25 study/decisions: `spec/SPEC_BR25_BEST_OF_BREED.md`, `SPEC_STUDY_BR25_ENFORCEMENT_CANDIDATES.md`,
  `SPEC_STUDY_HARNESS_WORKFLOW_ARTICULATION.md`, `SPEC_STUDY_CLI_ECOSYSTEM_GAPS.md`,
  `SPEC_STUDY_HARNESS_GENERICITY_AUDIT.md`.
- Pre-UAT evidence (2026-06-09): real claude+codex agents used harness with the directive;
  the negative control (mcp-wave, no directive) had claude reach for track → this overlap.
