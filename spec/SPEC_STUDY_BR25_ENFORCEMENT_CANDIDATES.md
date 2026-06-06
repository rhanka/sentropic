# SPEC_STUDY - BR25 Mechanical Enforcement Candidates

## Intention

Convert the objective-failure list from `SPEC_STUDY_BEST_OF_BREED_AGENT_METHODS.md` (Lot 4) into a set of independently reviewable hook or make-target candidates. Each candidate is scoped so that adoption, rollback, and review can happen in isolation.

## Status

This document is a study/watch artifact. It records candidates produced after the Lot 1-3 benchmark and the Lot 4 objective-failure list. Adoption of any candidate requires explicit human approval and a dedicated implementation branch (see `SPEC_STUDY_BR25_ENFORCEMENT_PLAN.md`).

## Selection criteria

A behavior is a candidate for mechanical enforcement only when all of the following hold:

- The failure is repeated in incident history or in BR-04B audit learnings.
- The failure is objectively detectable (no judgment required).
- The check can run locally and in CI with the same result.
- A clear bypass path exists for legitimate exceptions (`BRxx-EXn`).
- Rollback is a single revert.

Behaviors that fail any criterion remain written guidance.

## Candidates

Each candidate is sized so it can land as a single reviewable change. Counts below assume implementation lots that respect the 150 LOC commit ceiling.

### C1 - branch-check (read-only)

- Target failure: writes on the wrong branch (BR-04B incident: 10+ commits lost).
- Mechanism: pre-commit hook plus `make branch-check` target.
- Inputs: current branch, expected branch from `BRANCH.md` identity block, worktree path.
- Output: pass/fail with diff between expected and actual.
- Bypass: explicit `--allow-branch-mismatch` flag (logged in commit trailer).
- Rollback: remove hook, keep target.

### C2 - scope-check (read-only)

- Target failure: writes outside `Allowed Paths`, or into `Forbidden Paths` without `BRxx-EXn`.
- Mechanism: pre-commit hook plus `make scope-check` target.
- Inputs: staged file list, `BRANCH.md` Allowed/Forbidden/Conditional sections.
- Output: list of violations with rule reference.
- Bypass: declared exception ID present in `## Feedback Loop`.
- Rollback: remove hook, keep target.

### C3 - command-check (env placement)

- Target failure: `ENV=` placed before `make` instead of after, or missing.
- Mechanism: shell wrapper around `make` (opt-in via `make-wrap` target) plus CI lint of recorded transcripts.
- Inputs: invoked command line.
- Output: warning when `ENV=...` is shell-prefixed; error when `ENV` is required and missing.
- Bypass: `MAKE_WRAP_DISABLE=1` (must justify in commit message).
- Rollback: unset wrapper alias.

### C4 - forbidden-command guard

- Target failure: direct `npm`, `docker`, `git commit`, `git add .`, `git add -A`, or `make clean-all` on host.
- Mechanism: shell wrapper alias plus pre-commit hook for `git add` patterns.
- Inputs: invoked command and arguments.
- Output: blocked invocation with replacement suggestion (`make commit`, `make install-*`, etc.).
- Bypass: `--i-know` flag with mandatory commit-trailer note.
- Rollback: remove aliases.

### C5 - branch-md-shape

- Target failure: `BRANCH.md` drifts from `plan/BRANCH_TEMPLATE.md` (uses `###`, prose, missing checkboxes).
- Mechanism: `make branch-md-check` target plus pre-commit hook.
- Inputs: `BRANCH.md`, template skeleton, allowed-section list.
- Output: list of disallowed headers, missing required sections, or non-checkbox bullet violations.
- Bypass: none expected; template change requires its own branch.
- Rollback: remove hook.

### C6 - commit-size

- Target failure: commits above 150 LOC or 15 files.
- Mechanism: pre-commit hook computing diff stats; CI re-check on push.
- Inputs: staged diff numstat.
- Output: warning above 100 LOC, error above 150 LOC; same for files at 10/15.
- Bypass: `--allow-large` flag with reason recorded in commit body.
- Rollback: remove hook.

### C7 - branch-md-update

- Target failure: scoped work commits without checking off the matching `BRANCH.md` lot item.
- Mechanism: pre-commit hook comparing changed file paths against `BRANCH.md` Allowed Paths and lot checkboxes.
- Inputs: staged file list, `BRANCH.md` lot table.
- Output: warning when no checkbox in `BRANCH.md` was updated alongside scoped changes.
- Bypass: `--no-branch-update` for trivial fixes.
- Rollback: remove hook.

### C8 - test-env guard

- Target failure: tests launched on `ENV=dev` (root workspace).
- Mechanism: `make test-*` targets refuse `ENV=dev`; CI step asserts the same in workflow envs.
- Inputs: resolved `ENV` value at make-target entry.
- Output: explicit error pointing to branch ENV slot.
- Bypass: none; root UAT uses dedicated `make uat-*` targets, not `test-*`.
- Rollback: remove guard.

### C9 - merge-readiness uat-state

- Target failure: merge requested with empty UAT state on user-visible branches.
- Mechanism: `make merge-check` target plus PR template field; CI asserts presence of `uat_passed`, `uat_waived`, or `uat_not_applicable` in PR body or `BRANCH.md`.
- Inputs: PR body, `BRANCH.md` UAT block.
- Output: blocked merge with explicit state requirement.
- Bypass: `uat_waived` with recorded reason and risk owner.
- Rollback: remove CI assertion.

### C10 - report target

- Target failure: handoff without traceable Done/Checks/Risks/Scope/Read-set.
- Mechanism: `make report` target generating a markdown summary from `BRANCH.md`, git log, and recent CI status.
- Inputs: `BRANCH.md`, `git log`, optional `gh run list` output.
- Output: a single markdown report posted to PR or saved under `reports/`.
- Bypass: skip target (informational, not blocking).
- Rollback: remove target.

## Enforcement layering

Candidates ship in three layers, ordered by risk:

- Layer A (read-only, advisory): C1, C2, C5, C7, C10. No build-breaking behavior; only diagnostic output.
- Layer B (blocking on commit): C4, C6, C8. Moves repeated objective failures to commit-time errors with explicit bypass flags.
- Layer C (blocking on merge): C9 plus CI re-runs of A and B. Final gate before integration.

Each layer is its own implementation branch. Layer B does not start until Layer A has run advisory for at least one full release cycle in `main` and incident counts decrease.

## Per-candidate review checklist

For each candidate, the implementation branch must record:

- Failure history justifying the check (incident IDs, branch references).
- Concrete script/target diff with size estimate.
- Bypass mechanism and audit trail.
- Rollback instructions.
- Telemetry plan: how violations are surfaced (commit trailer, CI summary, report file).
- Sunset criterion: when this check becomes redundant or replaced by a stronger one.

## Out of scope

- Judgment-heavy checks (UX acceptability, spec sufficiency, fallback legitimacy, leakage of private context). These remain written guidance per `SPEC_STUDY_BEST_OF_BREED_AGENT_METHODS.md`.
- BR19 product-skill runtime checks (separate ownership).
- Public packaging (covered by the publication strategy, not by this candidate list).

## Cross-references

- `SPEC_STUDY_BEST_OF_BREED_AGENT_METHODS.md` (Lot 1-4 source).
- `rules/MASTER.md`, `rules/workflow.md` (current written guidance).
- `plan/BRANCH_TEMPLATE.md` (shape source for C5).
- `BRANCH.md` (current branch identity, scope, UAT state).
