---
description: "Sub-agent contract, execution rules, reporting, restart protocol"
alwaysApply: false
paths: ["plan/**"]
globs: ["plan/**"]
tags: [orchestration, workflow]
---

# SUBAGENTS

## Goal
Minimal, repeatable contract so each sub-agent delivers one orthogonal lot safely.

## Mandatory Read Order
1. `rules/workflow.md`
2. `rules/MASTER.md`
3. `rules/subagents.md`
4. Scope-relevant rules: `testing.md`, `security.md`, and others as needed
5. `README.md` and `TODO.md`
6. `PLAN.md` (mandatory when present)
7. Relevant `spec/*.md` files
8. Branch execution file (`BRANCH.md` or `plan/NN-BRANCH_*.md`)
9. `plan/BRANCH_TEMPLATE.md` (mandatory reference when creating/updating `BRANCH.md`)

## Required Launch Packet (from conductor)
- Branch id, name, working directory
- Exact scope (lot, files in/out of scope)
- Allowed / Forbidden / Conditional paths
- `PLAN.md` context (dependencies, wave, status)
- Environment mapping (`ENV`, `API_PORT`, `UI_PORT`, `MAILDEV_UI_PORT`)
- Port ownership check result
- Expected outputs (artifacts, tests, checkboxes)
- Stop conditions, scope exception format (`BRxx-EXn`)
- Commit policy (`make commit`, selective `git add`, never `git add .`)

## Execution Rules
- Make targets only (no direct Docker commands)
- `ENV=<env>` as last argument in all make commands
- End of lot: `make down ENV=<branch-env>` (unless conductor requests keep-up for UAT)
- Edit only `Allowed Paths`; never change `Forbidden Paths`
- `Conditional Paths` blocked until `BRxx-EXn` approved
- All code/comments/docs in English
- Do not commit/push unless explicitly requested
- Do not silently resolve ambiguities — raise structured question
- First `BRANCH.md` iteration: detailed lots, file-level tests, UAT checklist per surface

## Port Safety Rules
- Never start services on ports belonging to another active branch
- If port occupied by another compose project: stop and request new mapping
- Keep `ENV` explicit and consistent
- Each branch may reserve up to five concurrent sub-agent slots, numbered `0` through `4`
- For branch number `nn`, compute local slot ports as:
  - `API_PORT = 9000 + (nn * 5) + slot`
  - `UI_PORT = 5200 + (nn * 5) + slot`
  - `MAILDEV_UI_PORT = 1100 + (nn * 5) + slot`
- Example: BR-16 slot `0..4` uses API `9080..9084`, UI `5280..5284`, Maildev `1180..1184`
- Root dev/UAT remains reserved for the user on API `8787`, UI `5173`, Maildev `1080`; sub-agents never use those ports
- Launch packets must name the assigned slot owner and exact ports before any `make` command
- Active branch files and new sub-agent launch packets must use the slot convention when multiple agents or OAuth callback registration are involved

## Reporting Contract
1. **Done**: concrete changes with file paths
2. **Checks**: commands executed and outcomes
3. **Feedback Loop**: IDs/status, options, recommendation
4. **Risks**: regressions, dependencies, follow-up actions
5. **Scope adherence**: any `BRxx-EXn` used or `none`
6. **Read set**: rules + spec files actually read

- Escalate only after collecting evidence and attempting focused checks
- Batch questions once per lot unless new hard blocker

## Restart / Relaunch Protocol
1. `git status --short`
2. Read current branch execution file
3. Review unresolved `Feedback Loop` blockers first
4. Resume from first unchecked item of active lot
5. Preserve prior decisions unless conductor overrides
6. Report only delta since last run

## Branch Closure Handoff
1. Final lot checkbox status (tests/UAT)
2. Final `Feedback Loop` status (or explicit `none`)
3. Cleanup: `make down ENV=<branch-env>` + `make ps ENV=<branch-env>` = no remaining services
4. Residual risk to merge
5. All blocking feedback resolved before merge
6. For UAT worktrees: confirm commit-identical SHA with source branch

> WARNING: Pass ALL ports (API_PORT, UI_PORT, MAILDEV_UI_PORT) to subagents. Missing ONE kills dev environment. BR-04: test stack bound to default ports 8787/5173/1080, blocking `make dev`.

> WARNING: Announce agents before launching: count, what each does, confirm SUBAGENT_PROMPT_TEMPLATE usage. Wait for user OK.

> WARNING: Even Explore agents need relevant SUBAGENT_PROMPT_TEMPLATE context (read order, allowed/forbidden paths, env mapping, reporting contract).
