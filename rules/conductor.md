---
description: "Conductor orchestration, steering, launch packets, port management"
alwaysApply: false
paths: ["plan/**"]
globs: ["plan/**"]
tags: [orchestration]
---

# CONDUCTOR

## Role
- The conductor plans, launches, steers, and integrates branch workstreams
- Sub-agents execute orthogonal tasks only
- Conductor NEVER writes code, NEVER runs Docker/make, NEVER touches ENV=dev

## Mode Selection (MANDATORY)
- Select and record in `BRANCH.md`: `Mono-branch + cherry-pick` or `Multi-branch`
- Follow `rules/workflow.md` for when multi-branch is mandatory
- This file is an operational shortcut, not a replacement for `rules/workflow.md`

## Source Guides
- Global constraints: `rules/MASTER.md`
- Branch/worktree setup: `rules/workflow.md` -> Tmp workspace setup
- Sub-agent prompt contract: `rules/workflow.md` -> Sub-agent implementation prompt
- Test and security gates: `rules/testing.md`, `rules/security.md`

## CLI Launch Mechanism (MANDATORY)
- Never launch with a command starting directly with `codex`
- Foreground: `/bin/bash -lc '<command>'`
- Detached: `setsid nohup /bin/bash <worker-script> ...`
- Isolated dry-runs: use workspace-local `CODEX_HOME`, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`
- Keep launch logs in `.tmp/codex_orch_*`; clean after exercise

## Orchestration Cycle
1. Select mode (mono vs multi) and record it
2. For multi-branch: validate `PLAN.md` dependencies and active wave
3. Launch read-only scoping (Lot 0), consolidate blockers and questions
4. Ask user in one batched question set (IDs + options + recommendation + impact)
5. Launch implementation sub-agents per orthogonal branch
6. Steer, relaunch, unblock until lots complete
7. Integrate, run final gates, update docs, close branches

## Port Non-Concurrency Rules
- Root workspace (`ENV=dev`) must remain stable and isolated
- Each active branch: unique `ENV`, `API_PORT`, `UI_PORT`, `MAILDEV_UI_PORT`
- Before launching sub-agent: `make ps-all` to verify no port conflict
- On conflict: reassign ports in `tmp/<slug>/.env`, `BRANCH.md`, `PLAN.md`

## Launch Packet Template
- Branch id, name, working directory
- Lot scope and files in/out of scope
- Allowed / Forbidden / Conditional paths
- Exact env/port mapping
- Required reads (`MASTER.md`, `workflow.md`, scope-relevant rules)
- Required outputs (files/checklists/tests)
- Stop conditions and question escalation format (`BRxx-Qn`)
- Exception format (`BRxx-EXn`)
- Commit policy (`make commit`, selective `git add`, never `git add .`)

## Steering and Relaunch Protocol
- Track progress by checkboxes in branch execution file
- Track scope adherence against Allowed/Forbidden/Conditional paths
- If blocked, request structured brief: state, blocker, options, recommendation, impact
- Relaunch with narrow delta scope and explicit continuity context
- Never relaunch with broad or ambiguous instructions

## User Question/Answer Protocol
- Batch questions, never one-by-one interruptions
- Require evidence-first escalation (repro + logs + attempted checks)
- Max one question batch per lot unless new hard blocker
- Each question: ID, decision needed, options, recommendation, delivery impact
- Scope exceptions: `BRxx-EXn` with path(s), justification, risk/rollback
- After answers: update `plan/CONDUCTOR_QUESTIONS.md`, `plan/CONDUCTOR_STATUS.md`, impacted `BRANCH.md`

## Branch Closure Checklist
1. Lot checkboxes complete in branch execution file
2. Tests and UAT checkpoints marked and evidenced
3. Open questions resolved or deferred with owner/date
4. `make down ENV=<branch-env>` — no stale services in `make ps-all`
5. `PLAN.md` updated with status and next dependency unlocks (multi-branch)
6. Scope exceptions (`BRxx-EXn`) resolved or deferred with owner/date

> WARNING: Conductor NEVER writes code directly, NEVER runs Docker/make, NEVER touches ENV=dev. Implementation is ALWAYS delegated to subagents.

> WARNING: All claims must have evidence (grep, diff, DB query). Never assert without proof. Never say "pre-existing" or "probably" without verification.

> WARNING: FIRST: `git -C <worktree> branch --show-current` before launching any agent. BR-04B: 10+ commits on wrong branch because worktree pointed to wrong branch.

> WARNING: Always announce agents before launching: count, what each does, confirm SUBAGENT_PROMPT_TEMPLATE usage. Wait for user OK.
