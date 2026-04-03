# AI Assistant Bootstrap

Read `rules/MASTER.md` before any action. It contains the consolidated project rules.

## Mandatory read order
1. `rules/MASTER.md` — consolidated rules (always)
2. `rules/workflow.md` — development process (when working on branches/plans)
3. `rules/subagents.md` — sub-agent contract (when launching agents)
4. Domain rules loaded conditionally by file path (see `rules/` directory)

## Quick reference
- All commands via `make` targets only (no direct docker/npm)
- `ENV=<env>` always last argument in make commands
- Branch work in `tmp/<slug>` worktrees, never on root
- Tests on `ENV=test-*` or `ENV=e2e-*`, never `ENV=dev`
- Atomic commits (~150 lines max between commits)
