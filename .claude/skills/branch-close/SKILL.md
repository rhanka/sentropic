---
name: branch-close
description: Close a branch — final validation, PR creation, rules update, merge
paths: "**/BRANCH.md,PLAN.md"
allowed-tools: Read Write Bash Edit Glob Grep
---

# Branch Close

Workflow skill to close a branch through final validation, PR creation, and merge.

## Steps

1. **Verify all lots complete**
   Read BRANCH.md and verify:
   - All lot checkboxes are `[x]` (except Lot N items about to be executed)
   - All `## Feedback Loop` items are resolved (closed, deferred with owner/date, or cancelled)
   - No unauthorized scope drift (run `/scope-check` if available)

2. **Run final gate**
   Execute the full quality gate sequence:
   ```bash
   make typecheck-api ENV=<branch-env>
   make typecheck-ui ENV=<branch-env>
   make lint-api ENV=<branch-env>
   make lint-ui ENV=<branch-env>
   make test-api ENV=test-<branch-slug>
   make test-ui ENV=test
   make build-api build-ui-image API_PORT=<port> UI_PORT=<port> MAILDEV_UI_PORT=<port> ENV=e2e-<branch-slug>
   make clean test-e2e API_PORT=<port> UI_PORT=<port> MAILDEV_UI_PORT=<port> ENV=e2e-<branch-slug>
   ```
   For AI flaky tests: run scoped specs, document pass/fail signatures in BRANCH.md.

3. **Create or update PR**
   ```bash
   git push origin <branch-name>
   gh pr create --title "<branch title from BRANCH.md>" --body "$(cat BRANCH.md)"
   ```
   Or if PR already exists:
   ```bash
   gh pr edit <pr-number> --body "$(cat BRANCH.md)"
   ```
   PR body is the exact text of BRANCH.md (source of truth).

4. **Verify CI passes**
   ```bash
   gh run list --branch <branch-name> --limit 5
   gh run view <run-id>
   ```
   Wait for CI to complete. Resolve any failures before proceeding.

5. **After UAT + CI OK: merge**
   Once both UAT sign-off and CI are green:
   ```bash
   cd tmp/<slug>
   git rm BRANCH.md
   make commit MSG="chore: remove BRANCH.md for merge"
   git push origin <branch-name>
   ```
   Then merge via GitHub (or `gh pr merge`).

6. **Post-merge: update rules if needed**
   If this branch introduced new patterns, conventions, or workflow changes:
   - Invoke `/post-branch-update` skill (if available)
   - Or manually update relevant `rules/*.md` files to absorb learnings
   - Update code-oriented rules if implementation patterns changed

7. **Update PLAN.md status**
   If PLAN.md exists, update the branch status to `merged` with date.
   Clean up worktree:
   ```bash
   git worktree remove tmp/<slug>
   ```

## Rules

- PR body must be exact BRANCH.md content — no summarization
- Never merge with failing CI
- Never merge without UAT sign-off (when UAT lot exists)
- Always remove BRANCH.md before final merge commit
- Always update PLAN.md if it exists
- Record AI flaky test sign-off explicitly before merge
