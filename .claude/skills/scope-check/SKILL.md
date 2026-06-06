---
name: scope-check
description: Verify modified files against branch allowed/forbidden/conditional paths (via @sentropic/harness)
paths: "**/BRANCH.md"
allowed-tools: Bash
---

# Scope Check

Thin wrapper over the `@sentropic/harness` **C2 scope-check**. The classification logic lives ONCE
in the library (`packages/harness`), surfaced via `make scope-check` — this skill no longer
re-implements it in prose (BR-42h Lot 5c; D6 "skills → wrappers").

## Run

```bash
make scope-check    # advisory; never blocks (BR25 D5 Layer A)
```

`make scope-check` reads the branch `BRANCH.md` scope boundaries, gathers the local changed files
(`git diff --cached --name-only` ∪ `git diff --name-only`, deduped), classifies each against the
boundary + the `sentropic` profile, and prints `PASS`/`FAIL C2` plus any advisory violations.

> Run from the branch worktree root so `BRANCH.md` and `git` state are the branch's. The target
> builds the harness dist first; `--json` (a `VerificationRun`) is available on the underlying
> `harness check scope`.

## Classification (canonical — owned by the library)

Precedence, first match wins: **allowed > forbidden > conditional > profile-default > unknown**.

- **allowed** → OK. Allowed is the *granted* implementation scope: an explicitly-allowed subtree
  such as `packages/harness/**` intentionally wins over a broader forbidden `packages/**`.
- **forbidden** (explicit, or a profile default such as `Makefile` / `docker-compose*.yml` /
  `.cursor/rules/**`) → violation.
- **conditional** → violation unless a declared exception id matches the profile grammar (`BRxx-EXn`).
- **unknown** (outside Allowed/Forbidden/Conditional) → advisory violation — intentionally stricter
  than the old "warning", to surface undeclared scope drift.

All violations are **advisory** (D5 Layer A): reported, never blocking, until a blocking promotion.

## Rules

- Checks both staged and unstaged local changes.
- Run before every commit to catch scope drift early.
- The classification is owned by `@sentropic/harness` (`classifyPath` / `checkScope`) — change it
  there (with a test), never re-implement it in this skill.
