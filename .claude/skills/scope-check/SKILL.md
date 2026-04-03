---
name: scope-check
description: Verify modified files against branch allowed/forbidden/conditional paths
paths: "**/BRANCH.md"
allowed-tools: Read Bash Grep Glob
---

# Scope Check

Workflow skill to verify that modified files respect branch scope boundaries declared in BRANCH.md.

## Steps

1. **Read BRANCH.md scope boundaries**
   Parse the `## Branch Scope Boundaries (MANDATORY)` section and extract:
   - **Allowed Paths**: globs where implementation is permitted
   - **Forbidden Paths**: globs that must not be modified
   - **Conditional Paths**: globs that require a declared `BRxx-EXn` exception
   Also extract any declared exceptions from `## Feedback Loop`.

2. **Get modified files**
   For committed changes:
   ```bash
   git diff --name-only HEAD~1
   ```
   For uncommitted/staged changes:
   ```bash
   git diff --cached --name-only
   git diff --name-only
   ```
   Combine all modified files into a single list (deduplicated).

3. **Classify each file**
   For each modified file, match against scope boundaries in order:
   - **Allowed Paths** match -> `OK`
   - **Forbidden Paths** match -> `VIOLATION` (report immediately)
   - **Conditional Paths** match -> check if a `BRxx-EXn` exception is declared for this path
     - Exception declared -> `OK (exception BRxx-EXn)`
     - No exception -> `VIOLATION (missing exception)`
   - **No match** -> `WARNING (unknown path)`

4. **Report summary table**
   Output a markdown table:
   ```
   | File | Status | Detail |
   |------|--------|--------|
   | api/src/services/foo.ts | OK | Allowed path: api/** |
   | Makefile | VIOLATION | Forbidden path |
   | api/drizzle/0042.sql | OK (exception BR04-EX1) | Conditional path |
   | scripts/deploy.sh | WARNING | Unknown path |
   ```

   Final summary line:
   - `PASS` if zero violations
   - `FAIL` with count of violations

## Rules

- Always check both staged and unstaged changes
- Glob matching follows standard gitignore-style patterns
- A file matching both Allowed and Forbidden is a VIOLATION (Forbidden takes precedence)
- Conditional paths without a declared exception are VIOLATIONS
- Unknown paths are warnings, not violations — but should be investigated
- Run this check before every commit to catch scope drift early
