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
(none)

## AI Flaky tests
- Not applicable — no runtime code changes.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: Single-concern branch, no parallel workstreams needed.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT = start new Claude Code session in worktree, verify rules/skills load.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline & constraints**
  - [x] Confirm worktree `tmp/doc-skills` on `doc/skills` from main (85d4bb1e)
  - [x] Confirm scope boundaries
  - [x] No ENV/ports needed (no runtime services)

- [x] **Lot 1 — Migrate rules/ + MASTER condensation + feedback absorption**
  - [x] Create `rules/` directory at project root
  - [x] Convert 11 `.cursor/rules/*.mdc` → `rules/*.md` with dual frontmatter
  - [x] Condense `rules/MASTER.md` to 78 lines (level 1, alwaysApply: true)
  - [x] Set all other rules to conditional `paths:` (level 2, alwaysApply: false)
  - [x] Merge 18 AMPLIFIES feedbacks into target rules as WARNING blocks
  - [x] Create symlinks `.cursor/rules/*.md` → `../../rules/*.md`
  - [x] Create symlinks `.claude/rules/*.md` → `../../rules/*.md`
  - [x] Create `AGENTS.md` bootloader (15 lines)
  - [x] Create `CLAUDE.md` with `@rules/MASTER.md` import
  - [x] Lot gate:
    - [x] Symlinks verified: `ls -la .cursor/rules/ .claude/rules/`
    - [x] CLAUDE.md import syntax verified
    - [x] No forbidden path violation

- [x] **Lot 2 — Code-oriented conditional rules (5 new)**
  - [x] `rules/api-services.md` (paths: api/src/services/**, api/src/routes/**)
  - [x] `rules/ui-components.md` (paths: ui/src/lib/**, ui/src/routes/**)
  - [x] `rules/extensions.md` (paths: ui/chrome-ext/**, ui/vscode-ext/**)
  - [x] `rules/schema-migrations.md` (paths: api/src/db/schema.ts, api/drizzle/**)
  - [x] `rules/test-patterns.md` (paths: api/tests/**, ui/tests/**, e2e/**)
  - [x] Lot gate:
    - [x] All files < 150 lines
    - [x] All have valid dual frontmatter
    - [x] No forbidden path violation

- [x] **Lot 3 — Skills (14 total)**
  - [x] `.claude/skills/launch-agent/SKILL.md`
  - [x] `.claude/skills/lot-gate/SKILL.md`
  - [x] `.claude/skills/branch-init/SKILL.md`
  - [x] `.claude/skills/branch-close/SKILL.md`
  - [x] `.claude/skills/scope-check/SKILL.md`
  - [x] `.claude/skills/trace-impact/SKILL.md`
  - [x] `.claude/skills/provider-cascade/SKILL.md`
  - [x] `.claude/skills/new-route/SKILL.md`
  - [x] `.claude/skills/new-e2e/SKILL.md`
  - [x] `.claude/skills/debug-probe/SKILL.md`
  - [x] `.claude/skills/debug-api/SKILL.md`
  - [x] `.claude/skills/debug-streaming/SKILL.md`
  - [x] `.claude/skills/debug-extension/SKILL.md`
  - [x] `.claude/skills/post-branch-update/SKILL.md`
  - [x] Lot gate:
    - [x] All SKILL.md have valid frontmatter
    - [x] No forbidden path violation

- [ ] **Lot 4 — POST-MERGE: Hooks update + memory cleanup**
  - [ ] Update `.claude/settings.local.json` on root with 4 additional hooks
  - [ ] Evaluate if AGENT_SIG hook can be replaced by launch-agent skill
  - [ ] Delete 8 REDUNDANT memory feedback files
  - [ ] Delete 18 AMPLIFIES memory feedback files (now absorbed into rules)
  - [ ] Update `~/.claude/projects/.../memory/MEMORY.md` index (keep 4 UNIQUE + never_execute_before_validation)
  - `attention`: This lot operates on root workspace files outside branch scope — must be done post-merge

- [ ] **Lot N-2 — UAT**
  - [ ] Start new Claude Code session in `tmp/doc-skills`
  - [ ] Verify CLAUDE.md `@rules/MASTER.md` import loads correctly
  - [ ] Verify conditional rules load when touching matching files
  - [ ] Verify `/debug-probe` skill is invocable
  - [ ] Verify `/launch-agent` skill is auto-suggested when preparing to launch agent
  - [ ] Verify `.cursor/rules/` symlinks resolve in Cursor (if available)
  - [ ] Verify `AGENTS.md` is readable (plain markdown, no broken refs)

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] No spec to consolidate (governance-only branch)

- [ ] **Lot N — Final validation**
  - [ ] Final gate step 1: create PR using `BRANCH.md` text as PR body
  - [ ] Final gate step 2: verify CI passes (no runtime code changed, should be green)
  - [ ] Final gate step 3: once UAT + CI OK, commit removal of `BRANCH.md`, push, merge
