# Feature: BR-42h — `@sentropic/harness` follow-ons (handoff to scale / `stp`)

## Objective
Register, in the BR-42 scale family, the **remaining `@sentropic/harness` work** after the core
deliverable shipped, so the `stp`/scale program owns the continuation. The harness CORE is **done**
(BR-25 in-fine deliverable): `@sentropic/harness@0.1.1` published to npm (OIDC trusted publisher),
homogeneous `npm i -g` install, 3-host plugin surfaces (AGENTS/GEMINI/skill), C1 branch-check + C2
path-scope-check → neutral `VerificationRun`, profile-as-data SPI, pre-UAT PASSED on claude+codex+
gemini, parser bug found+fixed (0.1.1). The scope-ownership decision (`spec/SPEC_DECISION_SCOPE_OWNERSHIP_HARNESS_TRACK_STP.md`)
and the shared BRANCH.md grammar (`spec/SPEC_BRANCH_MD_GRAMMAR.md`) are ratified + merged. This file
is the **backlog handoff** — no implementation here.

## Status (2026-06-09)
- **DONE / shipped**: harness 0.1.0→0.1.1 (PRs #266, #279), OIDC attach, scope-ownership decision
  (PR #284), shared BRANCH.md grammar spec (PR #286). BR-42i `stp` federation MERGED (#261,
  `@sentropic/cli@0.2.0`); FEDERATION_MANIFEST marks `harness` as **GATED_D7** (in-process register
  ready, ZERO rework). BR-42k DISSOLVED into the harness discipline layer.
- **Owner**: scale / `stp` program (this is a BR-42 lot). Coordinated with the live BR-42i session.

## Backlog (ready lots — captured, not yet branched)
- [ ] **42h-L1 — D7 publish-federation register**: flip `@sentropic/harness` from monorepo-path to a
  federated `stp` subcommand. Per BR-42i: add `registry.register({name:'harness', summary, version,
  run:(argv)=>runHarnessCli(argv)})` + verb bindings at the `bin/stp.mjs` composition root; ping the
  BR-42i owner for the manifest/register snippet. `runHarnessCli` is already pure → no spawn, no dist
  dep. (harness is already public on npm; this is the federation wiring, not a republish.)
- [ ] **42h-L2 — `stp scope check` router**: implement the ratified router (track-master / harness-
  fallback / fail-closed-on-stale-track) per `SPEC_DECISION_SCOPE_OWNERSHIP_HARNESS_TRACK_STP.md`.
  Zero glob logic of its own (track→rules, harness→check, compose). Starts in harness-fallback mode
  until track ships scope-state (see Attendus).
- [ ] **42h-L3 — harness `discipline` layer (COMPLETENESS requirement)**: `harness discipline
  brainstorm|tdd|test|debug|review|verify` + `harness skill list/run`; superpowers (and per-host
  packs) as interchangeable BACKENDS behind the profile SPI, never agent-called directly; wrap output
  in the neutral `VerificationRun`. **`harness discipline review --consensus`** fans ≥2 independent
  peers (Opus 4.8 + Codex 5.5-xhigh) and reconciles into one run. Goal (rhanka reframe): COMPLETE
  coverage of the superpowers surface (brainstorm/plans/TDD/worktrees/verify/subagents/finishing) so
  superpowers is NEVER needed. Absorbs the dissolved BR-42k dev-tooling content.
- [ ] **42h-L4 — genericity G1–G6** (`spec/SPEC_STUDY_HARNESS_GENERICITY_AUDIT.md`): plan-adapter SPI +
  parser relocation (G1); profile-driven exception extraction + per-path exception binding + composed
  genericity test (G2); profile resolution + `.harness/config.json` (G3); `harness init` / `harness
  audit` (G4); nx-tag scope matchers (G5, YAGNI-deferred); env data-lifecycle table (G6, with the C8
  lot). G1/G2 BEFORE G3.
- [ ] **42h-L5 — enforcement candidates** (`spec/SPEC_STUDY_BR25_ENFORCEMENT_CANDIDATES.md`): C5
  branch-md-shape, C7 branch-md-update, C10 report (Layer A advisory); **C8 environment data-lifecycle
  guard** (Layer B blocking, generalized 2026-06-07); C6 commit-size; C9 merge-readiness.
- [ ] **42h-L6 — shared BRANCH.md grammar conformance** (`spec/SPEC_BRANCH_MD_GRAMMAR.md`): golden
  fixture + a conformance test in harness now (parser conforms post-0.1.1); track adds its conformance
  test when it wires scope-state.

## Attendus (other owners — coordinated via h2a, gate parts of the above)
- **track** (`claude:track`): acquire declarative scope-state (WP→spec-phase) + `track scope validate`
  + `VerificationRun` ingest → only THEN does `stp scope check` flip to track-master and the agent docs
  flip authority to track. Until then everything runs harness-fallback (42h-L2 handles it). h2a note
  `env:scope-ownership-decision:to-track-01` sent; **reply awaited**.
- **stp / BR-42i** (live): owns 42h-L1/L2 federation wiring; ACK exchanged (`env:harness-fed-ack:to-br42i-01`).

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** — L1..L6 are largely orthogonal harness follow-ons, parallelisable by scale;
  L2 depends on L1 (federation) for the `stp` surface; L4-G3 depends on L4-G1/G2.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Register the handoff** — this file + PLAN.md addendum + umbrella line (docs pass).
- [ ] **Lot 1..6** — see Backlog above; each becomes its own `feat/*` branch when scale schedules it.

## References
- Decision: `spec/SPEC_DECISION_SCOPE_OWNERSHIP_HARNESS_TRACK_STP.md` (PR #284).
- Grammar: `spec/SPEC_BRANCH_MD_GRAMMAR.md` (PR #286).
- Genericity audit: `spec/SPEC_STUDY_HARNESS_GENERICITY_AUDIT.md`.
- BR25 decisions/candidates: `spec/SPEC_BR25_BEST_OF_BREED.md`, `SPEC_STUDY_BR25_ENFORCEMENT_CANDIDATES.md`,
  `SPEC_STUDY_HARNESS_WORKFLOW_ARTICULATION.md`, `SPEC_STUDY_CLI_ECOSYSTEM_GAPS.md`.
- Federation: `plan/done/42i-BRANCH_feat-stp-federation.md`, `spec/SPEC_EVOL_STP_FEDERATION.md`.
