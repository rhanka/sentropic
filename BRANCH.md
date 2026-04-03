# Feature: Universal AI rules & skills architecture

## Objective
Migrate .cursor/rules/*.mdc to a universal `rules/` directory with dual frontmatter (Claude Code + Cursor), add `.claude/skills/` for auto-invocable workflows/debug, create AGENTS.md/CLAUDE.md bootloaders, deduplicate memory feedbacks into rules, and add a post-branch update skill.

## Scope / Guardrails
- Scope limited to rules governance files, skills scaffolding, bootloaders, and memory cleanup.
- No migration in `api/drizzle/*.sql`.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development in isolated worktree `tmp/doc-skills`.
- No automated test campaigns needed (no runtime code changes).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `rules/**`
  - `.claude/rules/**`
  - `.claude/skills/**`
  - `.claude/settings.local.json`
  - `.cursor/rules/**` (symlink replacement only)
  - `AGENTS.md`
  - `CLAUDE.md`
  - `.gitignore`
- **Forbidden Paths (must not change in this branch)**:
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception)**:
  - `plan/SUBAGENT_PROMPT_TEMPLATE.md` (if template needs updating for new skill refs)
- **Exception process**:
  - Declare exception ID `BRSK-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
(none yet)

## AI Flaky tests
- Not applicable — no runtime code changes.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: Single-concern branch, no parallel workstreams needed.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT after Lot 4 to validate rules/skills load correctly in Claude Code.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Confirm worktree `tmp/doc-skills` on `doc/skills` from main
  - [ ] Confirm scope boundaries
  - [ ] No ENV/ports needed (no runtime services)

- [ ] **Lot 1 — Migrate rules/ + MASTER condensation + feedback absorption**
  - [ ] Create `rules/` directory at project root
  - [ ] Convert 11 `.cursor/rules/*.mdc` → `rules/*.md` with dual frontmatter (`paths:`/`globs:`/`alwaysApply:`)
  - [ ] Condense `rules/MASTER.md` to ~80 lines (level 1, alwaysApply: true)
  - [ ] Set all other rules to conditional `paths:` (level 2, alwaysApply: false)
  - [ ] Merge 18 AMPLIFIES feedbacks into their target rules (incident context added as WARNING blocks)
  - [ ] Merge `architecture.mdc` + `components.mdc` content into code-oriented rules (Lot 2)
  - [ ] Create symlinks `.cursor/rules/*.md` → `../../rules/*.md` (one per file)
  - [ ] Create symlinks `.claude/rules/*.md` → `../../rules/*.md` (one per file)
  - [ ] Create `AGENTS.md` bootloader (~15 lines)
  - [ ] Create `CLAUDE.md` with `@rules/MASTER.md` import
  - [ ] Lot gate:
    - [ ] Verify symlinks resolve: `ls -la .cursor/rules/ .claude/rules/`
    - [ ] Verify CLAUDE.md import syntax
    - [ ] Verify no forbidden path violation: `git diff --name-only`

- [ ] **Lot 2 — Code-oriented conditional rules (5 new)**
  - [ ] Create `rules/api-services.md` (~100 lines, paths: api/src/services/**, api/src/routes/**)
  - [ ] Create `rules/ui-components.md` (~100 lines, paths: ui/src/lib/**, ui/src/routes/**)
  - [ ] Create `rules/extensions.md` (~100 lines, paths: ui/chrome-ext/**, ui/vscode-ext/**)
  - [ ] Create `rules/schema-migrations.md` (~80 lines, paths: api/src/db/schema.ts, api/drizzle/**)
  - [ ] Create `rules/test-patterns.md` (~100 lines, paths: api/tests/**, ui/tests/**, e2e/**)
  - [ ] Lot gate:
    - [ ] Each file < 150 lines
    - [ ] Each file has valid dual frontmatter
    - [ ] Verify no forbidden path violation: `git diff --name-only`

- [ ] **Lot 3 — Skills (13 total)**
  - [ ] Create `.claude/skills/launch-agent/SKILL.md` (workflow: subagent launch with template + ports + branch verify)
  - [ ] Create `.claude/skills/lot-gate/SKILL.md` (workflow: run typecheck + lint + scoped tests for a lot)
  - [ ] Create `.claude/skills/branch-init/SKILL.md` (workflow: create worktree + BRANCH.md from template)
  - [ ] Create `.claude/skills/branch-close/SKILL.md` (workflow: final validation + PR + merge + rules update)
  - [ ] Create `.claude/skills/scope-check/SKILL.md` (workflow: verify modified files vs allowed/forbidden paths)
  - [ ] Create `.claude/skills/trace-impact/SKILL.md` (code: trace schema/service change consumers)
  - [ ] Create `.claude/skills/provider-cascade/SKILL.md` (code: check all 5 LLM providers on change)
  - [ ] Create `.claude/skills/new-route/SKILL.md` (code: scaffold API route following patterns)
  - [ ] Create `.claude/skills/new-e2e/SKILL.md` (code: scaffold E2E test following patterns)
  - [ ] Create `.claude/skills/debug-probe/SKILL.md` (debug: Playwright scratch probe lifecycle)
  - [ ] Create `.claude/skills/debug-api/SKILL.md` (debug: logs, DB queries, traces investigation)
  - [ ] Create `.claude/skills/debug-streaming/SKILL.md` (debug: SSE, providers, delta aggregation)
  - [ ] Create `.claude/skills/debug-extension/SKILL.md` (debug: Chrome/VSCode extension issues)
  - [ ] Lot gate:
    - [ ] Each SKILL.md has valid frontmatter (name, description, paths or allowed-tools)
    - [ ] Verify no forbidden path violation: `git diff --name-only`

- [ ] **Lot 4 — Hooks update + cleanup**
  - [ ] Update `.claude/settings.local.json` with 4 additional hooks (commit size, BRANCH.md format, ports, branch verify)
  - [ ] Evaluate if AGENT_SIG hook can be replaced by launch-agent skill
  - [ ] Delete 8 REDUNDANT memory feedback files
  - [ ] Delete 18 AMPLIFIES memory feedback files (now absorbed into rules)
  - [ ] Update `~/.claude/projects/.../memory/MEMORY.md` index (keep only 4 UNIQUE + never_execute_before_validation)
  - [ ] Lot gate:
    - [ ] Verify hooks fire correctly: test each with a mock tool call
    - [ ] Verify memory MEMORY.md has correct links
    - [ ] Verify no forbidden path violation: `git diff --name-only`

- [ ] **Lot 5 — Post-branch update skill + testing strategy**
  - [ ] Create `.claude/skills/post-branch-update/SKILL.md` (update rules after branch completion: absorb learnings, update code rules if patterns changed, update PLAN.md)
  - [ ] Document testing approach in BRANCH.md: manual validation that Claude Code loads rules/skills correctly
  - [ ] Lot gate:
    - [ ] Skill has valid frontmatter
    - [ ] Verify no forbidden path violation

- [ ] **Lot N-2 — UAT**
  - [ ] Start new Claude Code session in `tmp/doc-skills`
  - [ ] Verify CLAUDE.md `@rules/MASTER.md` import loads correctly
  - [ ] Verify conditional rules load when touching matching files (e.g., read `api/src/services/chat-service.ts` → `api-services.md` activates)
  - [ ] Verify `/debug-probe` skill is invocable and injects dynamic context
  - [ ] Verify `/launch-agent` skill is auto-suggested when preparing to launch agent
  - [ ] Verify `.cursor/rules/` symlinks resolve in Cursor (if available)
  - [ ] Verify `AGENTS.md` is readable (plain markdown, no broken refs)

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] No spec to consolidate (governance-only branch)
  - [ ] Update PLAN.md if needed (add doc/skills completion note)

- [ ] **Lot N — Final validation**
  - [ ] Final gate step 1: create PR using `BRANCH.md` text as PR body
  - [ ] Final gate step 2: verify CI passes (no runtime code changed, should be green)
  - [ ] Final gate step 3: once UAT + CI OK, commit removal of `BRANCH.md`, push, merge
