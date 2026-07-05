# AI Assistant Bootstrap (Gemini)

Same contract as every agent CLI in this repo: read `AGENTS.md` then `rules/MASTER.md`
before any action.

## Scope & branch discipline — use `harness` (mandatory)
- Verify branch and scope MECHANICALLY with `@sentropic/harness`; never hand-check
  and never use generic verification skills for this:
  - `make scope-check` — local changes (staged+unstaged) vs the branch `BRANCH.md`
  - `harness check scope|branch ...` — host CLI, installed like the other @sentropic CLIs: `npm i -g @sentropic/harness`
- Run `make scope-check` before every commit; `harness check branch` before any work
  on a worktree. These supersede overlapping generic agent skills for scope/branch checks.
