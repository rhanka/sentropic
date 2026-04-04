---
name: launch-agent
description: Launch a subagent with proper template, ports, branch verification, and user announcement
allowed-tools: Read Bash Agent Glob Grep
---

# Launch Agent

Workflow skill to launch sub-agents following the mandatory SUBAGENT_PROMPT_TEMPLATE contract.

## Steps

1. **Verify branch**
   ```bash
   git -C <worktree-path> branch --show-current
   ```
   Abort if the current branch does not match the expected branch from BRANCH.md or PLAN.md.

2. **Read the template**
   Read `plan/SUBAGENT_PROMPT_TEMPLATE.md` in full. This is the source of truth for the agent prompt structure.

3. **Fill the launch packet**
   Populate every field from the template:
   - Branch ID and branch name
   - Worktree path (`tmp/<slug>`)
   - Mode: `planning-only` or `implementation`
   - Branch baseline (SHA or ref)
   - One-line objective
   - Primary target files
   - Allowed paths for the run
   - SPEC files to read
   - Specific instruction block:
     - Expected design/work outcome
     - Dependency gates from upstream branches/spec decisions
     - Explicit in-scope items
     - Explicit out-of-scope items
     - UAT surfaces to include
     - Additional constraints

4. **Allocate ports (all 3 mandatory)**
   Every sub-agent MUST receive all three ports:
   - `API_PORT` (convention: 87xx based on branch index)
   - `UI_PORT` (convention: 51xx based on branch index)
   - `MAILDEV_UI_PORT` (convention: 10xx based on branch index)
   Missing even ONE port kills the dev environment. Verify port availability before assignment.

5. **Announce to user**
   Before launching, present:
   - Number of agents to launch
   - What each agent will do (one-line summary per agent)
   - Confirm: "Using SUBAGENT_PROMPT_TEMPLATE verbatim"
   - List allocated ports per agent
   - List worktree paths per agent

6. **WAIT for user validation**
   Do NOT launch any agent until the user explicitly confirms. This is a blocking gate.

7. **Launch with AGENT_SIG**
   Include `AGENT_SIG:7f3a9c2e1b` in every agent prompt. This signature allows tracking which agents are active.

## Mandatory rules (from SUBAGENT_PROMPT_TEMPLATE)

- Sources of truth read order: `rules/MASTER.md` -> `rules/workflow.md` -> `rules/subagents.md` -> `rules/testing.md` -> `rules/security.md` -> domain rules -> `PLAN.md` -> SPEC files -> `BRANCH.md` -> `plan/BRANCH_TEMPLATE.md`
- BRANCH.md must follow `plan/BRANCH_TEMPLATE.md` strictly
- Commit via `make commit MSG="type: description"` only
- Staging: `git add <specific-files>` then `make commit` — never `git add .`
- Environment: `ENV=<dev|test|e2e>-<branch-slug>`, `ENV` as last argument
- No timeout inflation in tests
- Approval-safe execution: if a command may require escalation, report to conductor and wait
