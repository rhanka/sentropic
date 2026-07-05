# SPEC_STUDY - BR25 Mechanical Enforcement Implementation Plan

## Status

This document is a study/watch artifact. It outlines a small, staged implementation plan for the Lot 4 enforcement candidates (`SPEC_STUDY_BR25_ENFORCEMENT_CANDIDATES.md`). Implementation requires explicit human approval (BR25 D5/D6/D7 in `SPEC_BR25_BEST_OF_BREED.md`) and a dedicated branch outside BR25.

## Principles

- Read-heavy first: every check ships as a `make` target before any hook is wired.
- One candidate per branch: each enforcement change is independently reviewable, revertable, and auditable.
- Advisory before blocking: at least one release cycle of advisory output before any check becomes a commit-time error.
- No agent-only checks: every target must be invokable by humans and CI with the same result.
- Bypass is explicit and traceable: each blocking check exposes a named flag and writes the reason to the commit trailer or PR body.

## Branch slicing

A single BR-XX branch ships one candidate or one tightly grouped pair. Order below assumes Layer A (advisory) candidates ship first.

- BR-XX-1: `make scope-check` target reading `BRANCH.md` Allowed/Forbidden/Conditional sections vs `git diff --cached --name-only`. Output is a list of violations with rule reference. No hook.
- BR-XX-2: `make branch-check` target comparing current branch vs `BRANCH.md` identity block. Output is pass/fail. No hook.
- BR-XX-3: `make branch-md-check` target validating `BRANCH.md` shape against `plan/BRANCH_TEMPLATE.md` skeleton (header allow-list, required sections, checkbox-only bullets in lot tables).
- BR-XX-4: `make report` target generating Done/Checks/Risks/Scope/Read-set markdown from `BRANCH.md`, `git log`, and optional `gh run list` output. Saved under `reports/<branch>-<date>.md`.
- BR-XX-5: `make merge-check` target asserting one of `uat_passed`/`uat_waived`/`uat_not_applicable` is recorded in `BRANCH.md` UAT block or PR body. Initially advisory.
- BR-XX-6: pre-commit hook installer (`make install-hooks`) plus `.githooks/pre-commit` invoking C1 + C2 + C5 + C7 in advisory mode. Hook is opt-in via `core.hooksPath`.
- BR-XX-7: `make commit-size-check` target plus advisory pre-commit warning above 100 LOC, error above 150 LOC (still advisory at first; promotion to blocking is a separate branch).
- BR-XX-8: forbidden-command guard. Provide a shell wrapper alias snippet in `scripts/dev-shell-aliases.sh` documenting blocked patterns; CI step greps recorded transcripts for violations. No host enforcement.
- BR-XX-9: env-placement check. `make env-check ARGS="<command>"` parses one make-style invocation and reports if `ENV=...` is shell-prefixed.
- BR-XX-10: test-env guard. `make test-*` targets refuse `ENV=dev`; CI workflow step asserts the same. This is the only Layer B candidate that ships before a full advisory cycle because the failure mode is destructive (incident 2026-03-14).

## File and target inventory

Per implementing branch, expected new artifacts:

- `Makefile` additions: one `make <name>-check` target plus dependencies; never modify existing targets unless the candidate explicitly wraps them.
- `scripts/<name>.sh`: thin POSIX-shell implementation reading inputs from env or arguments; no agent-only logic.
- `.githooks/pre-commit` (BR-XX-6 only): single entry point dispatching to advisory checks; never rewrites staged files.
- `reports/`: created once by BR-XX-4; gitignored except for a `.gitkeep`.
- `docs/ENFORCEMENT.md`: per-candidate documentation block appended (one block per branch).

## Verification per branch

Each implementing branch must:

- Add unit-style tests for the script under `scripts/tests/<name>.bats` or equivalent shell test runner already in repo.
- Add a CI job step that runs the new target on a synthetic fixture (passing case + failing case).
- Record incident IDs justifying the check in the branch `BRANCH.md` Identity block.
- Provide rollback instructions in the PR body (single revert + cleanup).
- Declare verification category (`static`) in the handoff report.

## Sequencing constraints

- BR-XX-3 (branch-md-check) requires `plan/BRANCH_TEMPLATE.md` to be stable; freeze the template in its own micro-branch first if drift is suspected.
- BR-XX-6 (pre-commit hook installer) cannot ship before BR-XX-1, BR-XX-2, BR-XX-3 because it depends on those targets existing.
- BR-XX-10 (test-env guard) can ship in parallel with Layer A because it touches only `make test-*` recipes.
- BR-XX-5 (merge-check) requires PR template alignment; coordinate with BR-24 only if BR-24 reshapes workflows during the same window.

## Telemetry

Each blocking check writes a structured trailer to the commit message or PR body:

```
Enforcement: <check-name>
Result: <pass|advisory|bypass>
Reason: <free text when advisory or bypass>
Rule: <rule-source-link>
```

Advisory results never block; they are aggregated in the next `make report` output to measure violation rates and inform Layer B promotion.

## Sunset and rollback

- A check is sunset when its violation rate is zero for two consecutive release cycles, or when a stronger upstream check supersedes it.
- Rollback for any candidate is a single revert of its branch plus removal of the documentation block. Hooks installed via `core.hooksPath` are deactivated by `git config --unset core.hooksPath`.

## Out of scope

- Public CLI distribution (deferred per BR25 D7).
- Judgment-heavy automation (UX acceptability, spec sufficiency, fallback legitimacy).
- BR-19 product-skill runtime checks.
- Agent-only commit message linting beyond the structured Enforcement trailer.

## Cross-references

- `SPEC_STUDY_BR25_ENFORCEMENT_CANDIDATES.md` (candidate list and selection criteria).
- `SPEC_BR25_BEST_OF_BREED.md` (decisions D1-D7 pending approval).
- `rules/MASTER.md`, `rules/workflow.md` (current written guidance).
- `plan/BRANCH_TEMPLATE.md` (shape source for BR-XX-3).
