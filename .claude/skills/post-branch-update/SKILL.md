---
name: post-branch-update
description: Update rules and skills after a branch completes — absorb learnings, update patterns
paths: "PLAN.md,**/BRANCH.md,rules/**"
allowed-tools: Read Write Edit Bash Grep Glob
---

## Post-Branch Update Workflow

Run this after a branch is merged to keep rules/ and skills/ current.

### 1. Identify what the branch changed
`git log main~10..main --oneline --stat | head -60`

### 2. Check if rules need updating

- **New API patterns** (new service, new route convention) → update `rules/api-services.md`
- **New UI patterns** (new component type, new store pattern) → update `rules/ui-components.md`
- **New extension features** (new tool, new auth flow) → update `rules/extensions.md`
- **Schema changes** (new tables, new JSONB fields) → update `rules/schema-migrations.md`
- **New test patterns** (new helpers, new fixtures) → update `rules/test-patterns.md`
- **Workflow changes** (new make targets, new env conventions) → update `rules/workflow.md` or `rules/MASTER.md`
- **Incident learnings** (bugs caused by missing rules) → add WARNING block in relevant rule

### 3. Check if skills need updating

- **New make targets** → update relevant skills (lot-gate, debug-api, etc.)
- **New provider added** → update `provider-cascade` skill
- **New test helpers** → update `new-e2e` or `test-patterns` rule
- **New debug tooling** → update relevant debug skill

### 4. Check context budget

- `rules/MASTER.md` must stay < 100 lines (always loaded)
- Conditional rules must stay < 150 lines each
- If a rule grows too large → split into sub-rule with narrower `paths:`

### 5. Update PLAN.md
- Mark the completed branch as `done`
- Update wave scheduling if dependencies changed
- Note any new branches spawned from learnings

### 6. Commit
`git add rules/ .claude/skills/ PLAN.md && git commit -m "chore: post-branch rules update after <branch-name>"`
