# Fix: sync root package-lock.json with packages/mcp-platform

## Objective
After PR #371 landed the private package `packages/mcp-platform`, it became a `packages/*` workspace member but was absent from the root `package-lock.json` (the only desynced member). The next root install on main would fail (lockfile out of sync). Regenerate the root lock via `make lock-root` to include it. The package stays `"private": true` (NOT published) — this is lockfile hygiene, NOT P1 package activation/publication. Supersedes the overly-cautious F9 stance ("never add to root lock") which conflated lock hygiene with publication.

## Scope / Guardrails
- Lock-only change; `packages/mcp-platform` stays `"private": true`, not published, not in any CI publish list.
- Generated via `make lock-root` (sanctioned target); no manual lockfile edit.
- No dependency version churn: diff adds only the `packages/mcp-platform` subtree (+ a benign npm normalization removing a stray `version` field from the `@sentropic/llm-gateway` link entry).

## Allowed Paths
- `package-lock.json`
- `BRANCH.md`

## Forbidden Paths
- `Makefile`
- `docker-compose*.yml`
- `package.json`
- `packages/**`

## Conditional Paths
- (none)

## Scope Exceptions
- `FIX-EX1` — touch root `package-lock.json` (default-sensitive). Rationale: unbreak root install on main introduced by PR #371's new workspace member. Impact: lock-only, regenerated via `make lock-root`, no foreign package version change. Rollback: revert this commit.

## Lots
- [x] Regenerate root lock via `make lock-root`
- [x] Verify diff is lock-only, adds only `packages/mcp-platform`, no foreign version churn

## Feedback Loop
- (none)
