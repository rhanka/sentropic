---
name: branch-init
description: Initialize a new feature branch with worktree, BRANCH.md from template, and environment setup
allowed-tools: Read Write Bash Glob
---

# Branch Init

Workflow skill to initialize a new feature branch with proper worktree, BRANCH.md, and environment.

## Steps

1. **Create worktree**
   ```bash
   git worktree add tmp/<slug> -b <branch-type>/<slug> main
   ```
   Where `<branch-type>` is one of: `feat`, `fix`, `boot`, `doc`, `refactor`.
   Where `<slug>` is a short kebab-case identifier for the branch.

2. **Verify branch**
   ```bash
   git -C tmp/<slug> branch --show-current
   ```
   Must output `<branch-type>/<slug>`. Abort if mismatch.

3. **Read template**
   Read `plan/BRANCH_TEMPLATE.md` in full. This is the formatting contract for BRANCH.md.

4. **Create BRANCH.md from template**
   Fill in the template with:
   - **Title**: feature name
   - **Objective**: one or two sentences describing the goal
   - **Scope / Guardrails**: areas in scope, constraints
   - **Branch Scope Boundaries**:
     - Allowed Paths: list of globs for implementation scope
     - Forbidden Paths: `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `plan/NN-BRANCH_*.md`
     - Conditional Paths: sensitive paths requiring `BRxx-EXn` exception
   - **Orchestration Mode**: mono-branch (default) or multi-branch with rationale
   - **Plan / Todo**: lot-by-lot breakdown starting with Lot 0 (baseline)

   BRANCH.md must follow `plan/BRANCH_TEMPLATE.md` strictly:
   - No `###` headers
   - No prose paragraphs
   - Checkbox-only format for tasks
   - Bugs go in `## Feedback Loop`

5. **Allocate ports based on branch index**
   Convention for port allocation:
   - `API_PORT=87<nn>` (e.g., 8788, 8789, 8790...)
   - `UI_PORT=51<nn>` (e.g., 5174, 5175, 5176...)
   - `MAILDEV_UI_PORT=10<nn>` (e.g., 1084, 1085, 1086...)
   Record port allocation in BRANCH.md Lot 0.
   If PLAN.md exists, check existing branch port allocations to avoid conflicts.

6. **Commit**
   ```bash
   cd tmp/<slug>
   git add BRANCH.md
   make commit MSG="chore: init BRANCH.md for <branch-type>/<slug>"
   ```

## Rules

- Write BRANCH.md AFTER worktree creation, never before
- Never use `git add .` or `git add -A`
- `ENV` must be last argument in all `make` commands
- Copy `plan/BRANCH_TEMPLATE.md` structure exactly — do not reinvent
- First BRANCH.md iteration must be detailed: lot-by-lot tasks, file-level test lists, UAT checklists
