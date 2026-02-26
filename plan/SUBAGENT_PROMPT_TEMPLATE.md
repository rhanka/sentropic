# Sub-Agent Prompt Template

## Goal
Provide a reusable prompt for sub-agents where branch design is driven by `.mdc` rules, SPEC documents, `PLAN.md`, and `BRANCH.md`, while preserving `plan/BRANCH_TEMPLATE.md` structure.

## What This File Is
- This is a template to generate future sub-agent prompts.
- This is not a one-off prompt tied to one branch.
- The conductor fills the launch packet values before sending the prompt.

## Launch Packet (fill before sending)
- Branch ID and branch name.
- Worktree path.
- Mode (`planning-only` or `implementation`).
- Branch baseline (`SHA` or `ref`).
- One-line objective.
- Primary target files.
- Allowed paths for the run.
- SPEC files to read.
- Specific instruction for this run:
  - Expected design outcome.
  - Dependency gates from upstream branches/spec decisions.
  - Explicit in-scope items.
  - Explicit out-of-scope items.
  - UAT surfaces to include.
  - Additional constraints.

## Dev Tools and Environment Rules (.mdc references)
- `workflow.mdc`, `subagents.mdc`, `testing.mdc` apply as hard constraints.
- Use `make` targets only (no direct Docker commands).
- Run branch work in isolated worktree `tmp/<branch-slug>`.
- Never use shell-prefix variable assignment before `make` (forbidden): `ENV=... make ...`.
- Always use command form: `make <target> <vars> ENV=<env>` with `ENV` strictly last.
- Environment naming convention (per `workflow.mdc` + `subagents.mdc` + `testing.mdc`):
  - Branch environments: `ENV=<dev|test|e2e>-<branch-slug>`.
  - Root workspace stable environment remains `ENV=dev` (reserved for user dev/UAT).
- Keep `ENV=<env>` as the last argument in each `make` command.
- Keep ports isolated per branch: `API_PORT`, `UI_PORT`, `MAILDEV_UI_PORT`.
- Run automated tests on dedicated branch environments (`ENV=test-<branch-slug>` / `ENV=e2e-<branch-slug>`), never on root `ENV=dev`.
- Approval-safe execution:
  - If a command is likely to require user approval/escalation, do not execute it directly from sub-agent.
  - Instead, report the exact command to conductor and wait for conductor execution/confirmation.
  - If a sub-agent accidentally triggers an approval prompt and blocks, stop immediately and report the blocked command.

## Prompt (copy/paste)
You are sub-agent owner of the branch and worktree described in the launch packet.

# Mission
- Execute exactly the mode requested in the launch packet (`planning-only` or `implementation`).
- Use the branch baseline and objective from the launch packet.
- Focus only on the primary target files in the launch packet.

# Sources of truth (mandatory read order)
1) `.cursor/rules/workflow.mdc` (primary orchestration contract)
2) `.cursor/rules/MASTER.mdc`
3) `.cursor/rules/subagents.mdc`
4) `.cursor/rules/testing.mdc`
5) `.cursor/rules/security.mdc`
6) Relevant domain `.mdc` only if needed (`architecture`, `data`, `components`, `design-system`, `conductor`)
7) `PLAN.md` (branch dependencies, wave sequencing, status)
8) SPEC files listed in the launch packet, focus on <SPEC_FILES> and <SPEC_EVOL_FILES>
9) `BRANCH.md` for this branch (current execution state and exceptions)
10) `plan/BRANCH_TEMPLATE.md` as formatting contract for `BRANCH.md` evolution

# Formatting contract for BRANCH.md
- Respect `plan/BRANCH_TEMPLATE.md` exactly for sections and checklist style.
- If `workflow.mdc` specifies stricter structure, apply the stricter rule.
- Do not invent alternate section formats.

# Planning depth (mandatory on first BRANCH.md iteration)
- Produce a detailed lot-by-lot execution plan (no high-level placeholders only).
- For tests, list files explicitly:
  - API tests at file granularity (`existing + updated + new`).
  - UI tests at file granularity (`existing + updated + new`).
  - E2E tests at file granularity (`existing + updated + new`).
- Provide exact `make` commands for scoped runs and lot gates.
- Provide detailed UAT checklist items (step-level) for each impacted surface.

# Execution rules
- You are not alone in the codebase; ignore unrelated edits from others and do not revert them.
- Keep scope strict to allowed paths from the launch packet.
- If a prerequisite is unresolved, create a Feedback Loop item (`blocked` or `attention`) instead of guessing.
- Enforce tooling/environment constraints from `workflow.mdc`, `subagents.mdc`, and `testing.mdc`: Make-only workflow, branch env naming `ENV=<dev|test|e2e>-<branch-slug>` (except root `ENV=dev`), `ENV` as last make argument, and isolated ports.
- Before running any `make`, validate command shape locally: `make <target> ... ENV=<env>` (ENV last, no shell-prefix env assignment).
- No timeout inflation in tests.
- Default: do not commit.

# Specific instruction (mandatory, provided in launch packet)
- <Expected work outcome>
- <Scope in / scope out>
- <Dependencies and assumptions>
- <Acceptance criteria (tests/UAT/doc output)>
