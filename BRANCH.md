# Feature: BR-42h-L3 — harness method-verb layer (native superpowers-surface replacement)

## Objective
Implement the homogeneous `harness <verb> [<subject>] [--<option>]` layer that REPLACES superpowers
with native sentropic capability: mechanical verbs (`verify`/`branch`/`init`/`audit`/`skills`) emit
neutral `VerificationRun`/`WorkEvent`; method verbs (`brainstorm`/`test`/`debug`/`review`/`plan`) record
a `WorkEvent` and point to a `harness/*` skill that carries the LLM reasoning. Taxonomy decided by an
Opus 4.8 peer co-design + track solicitation (see `plan/42h-BRANCH_feat-harness-followons.md` L3).

## Scope / Guardrails
- Scope limited to `packages/harness/**` (pure tooling lib; no product runtime, no `@sentropic/*` deps).
- `runHarnessCli` stays PURE: no `process.exit`, no git/docker calls, no fs writes — reads supplied argv,
  writes via `out`, returns an exit code. Side-effects (worktree, skills copy) are make/host recipes the
  verbs PRINT, never perform. Mirrors the existing `check scope|branch` design.
- Make-only workflow; harness lane: `make typecheck-harness`, `make test-harness`, `make build-harness`,
  `make pack-harness`. No services → no ports, no UAT stack, no `ENV=dev`.
- Test env: `ENV=test-harness-verbs` (vitest in docker). All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/harness/src/**`
  - `packages/harness/tests/**`
  - `packages/harness/skills/**`
  - `packages/harness/package.json`
  - `packages/harness/README.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md`
  - any `api/**`, `ui/**`, `e2e/**`, other `packages/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - none anticipated.
- **Exception process**: declare `BR42h-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- **UAT-B result (agent-driven, 2026-06-10)** `acknowledge`: real agents `claude` + `codex` BOTH chose
  `harness/debug` + `harness check scope` + `harness/brainstorm` over the superpowers equivalents (the
  supersede directive works). `gemini` `attention`: env-blocked — headless CLI demands `GEMINI_API_KEY`
  (only OAuth creds present in this box), so its live run could not complete. NOT a harness defect: the
  `gemini` install path is implemented + unit-tested (`skills install --host gemini`), and the directive
  is host-agnostic skill text validated identically by 2/3 real agents. User can run the gemini in-vivo
  check with their own key.

## AI Flaky tests
- N/A — harness has no AI/provider-dependent tests (pure deterministic unit tests).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** — single package, sequential lots, one final gate.
- [ ] Multi-branch
- Rationale: all lots touch one package (`packages/harness`), mostly the shared CLI router; serial avoids
  merge churn on `src/cli/run.ts`.

## UAT Management (in orchestration context)
- Mono-branch. No UI/stack UAT (pure CLI lib). UAT = the user's in-vivo install (`npm i -g`) drives the
  verbs in a real repo after merge. Lot gate = `make typecheck-harness` + `make test-harness`.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & branch setup**
  - [x] Worktree `tmp/harness-method-verbs` off `origin/main` (harness 0.1.1), branch `feat/harness-method-verbs`.
  - [x] Read harness src/tests, `verification-run.ts`, `emit.ts`, profile SPI, Makefile harness lane.
  - [x] Confirm pure-CLI invariant + verb/skill split from the decided taxonomy.

- [x] **Lot 1 — `WorkEvent` neutral artifact**
  - [x] `src/artifacts/work-event.ts` — emit-only narrative event (kind, verb, status, refs, ts) + types.
  - [x] `src/run/work-event.ts` — `toWorkEvent(...)` assembler (pure, deterministic).
  - [x] Export from `src/index.ts`.
  - [x] Tests `tests/artifacts/work-event.spec.ts` (4 tests).
  - [x] Lot gate: typecheck-harness clean + test-harness 36/36 green (ENV=test-harness-verbs).

- [x] **Lot 2 — CLI verb router + method verbs**
  - [x] Refactor `src/cli/run.ts` to a verb-dispatch table; `check scope|branch` byte-identical (cli-smoke 6/6 green).
  - [x] `src/cli/args.ts` (shared argv helpers) + `src/cli/method-verbs.ts` for `brainstorm`, `test`, `debug`,
    `review`, `plan`, `branch` (init|close), `skills` (install) — each emits a `WorkEvent` + prints skill pointer (pure).
  - [x] Updated `USAGE` listing all verbs.
  - [x] Tests `tests/cli/method-verbs.spec.ts` (10 tests: routing, `--json` WorkEvent, skill pointers, sub-verb positional, usage errors).
  - [x] Lot gate: typecheck clean + test-harness 46/46 green.

- [x] **Lot 3 — mechanical producers: `verify` / `init` / `audit`**
  - [x] `harness verify --category <c> [--json]` — category roll-up emitting a `VerificationRun` (aggregates C1+C2).
  - [x] `harness init [--profile sentropic|stub]` — emits a profile descriptor (the SPI data) for any repo.
  - [x] `harness audit [--staged-files …] [--branch-md …] [--profile …]` — repo-vs-profile drift → `VerificationRun(static)`.
  - [x] Shared `src/cli/scope.ts` (de-dup: `check scope` + `verify` + `audit` parse BRANCH.md in one place).
  - [x] Tests `tests/cli/mechanical-verbs.spec.ts` (11 tests).
  - [x] Lot gate: typecheck clean + test-harness 57/57 green. NB: run `make` with `-C <worktree>` (cwd reverts to root across turns).

- [x] **Lot 4 — `harness/*` skill pack + `skills install` plan**
  - [x] `packages/harness/skills/{using-harness,brainstorm,test,debug,review,plan,adopt}/SKILL.md` —
    native reimplementations grounded on our rules; using-harness carries the supersede directive.
  - [x] `src/skills/manifest.ts` (canonical pack inventory + host dirs) exported from `index.ts`.
  - [x] `harness skills install --host claude|codex|gemini` prints the per-skill install plan (source → host dir).
  - [x] `package.json` `files` includes `skills` (ships in the npm tarball).
  - [x] Tests `tests/cli/skills-install.spec.ts` (4 tests, incl. fs inventory: every manifest entry ships a SKILL.md).
  - [x] Lot gate: typecheck clean + test-harness 61/61 green.

- [ ] **Lot N — Final validation**
  - [x] `make typecheck-harness` clean + `make test-harness` 61/61 + `make pack-harness` (tarball ships dist + 7 skills/).
  - [x] Bump `packages/harness/package.json` 0.1.1 → 0.2.0 (minor: additive verb surface) + description.
  - [x] Update `README.md` verb table + skill-pack section.
  - [x] Agent-driven UAT: UAT-A real built bin runs every verb (correct output + exit codes); UAT-B real
    agents claude+codex choose harness verbs over superpowers (gemini env-blocked on API key — see Feedback Loop).
  - [ ] Final gate: PR with this `BRANCH.md` as body → CI green → remove `BRANCH.md` → merge (user authorized loop-until-merge).
