# Fix: repo-wide high-severity npm audit drift (Jul 2026)

## Objective
Unblock CI for all open PRs. The `npm audit --audit-level=high` gate in the API/UI image builds
(`api/Dockerfile`, `ui/Dockerfile`) fails repo-wide since new advisories landed on the default
branch after main last built green (#436, 2026-07-20). Four HIGH transitive advisories now trip
the gate; pin each to its patched version via root `overrides` (non-breaking) and regenerate the
lockfile. Moderate advisories (`@hono/node-server`, `hono`, `dompurify`) do NOT trip the
`--audit-level=high` gate and are deliberately out of scope.

## Scope / Guardrails
- Dependency-only change: root `package.json` `overrides` + regenerated `package-lock.json`.
- No source, no Makefile, no docker-compose change.
- Each override pins the advisory-declared patched version, all within the same major (non-breaking).
- Make-only workflow. All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `package.json` (root `overrides` only)
  - `package-lock.json` (regenerated via `make lock-root`)
  - `BRANCH.md`
- **Forbidden Paths**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
  - `api/**`, `ui/**`, `packages/**`, `apps/**` (no source or per-package manifest change)
- **Exception process**: declare `BRsec-EXn` in `## Feedback Loop` before touching any forbidden path.

## Advisories fixed (HIGH only — the gate is `--audit-level=high`)
- `brace-expansion` — DoS GHSA-3jxr-9vmj-r5cp — 1.1.15 → 1.1.16 (v1 tree), 2.1.1 → 2.1.2 (v2 tree)
- `fast-uri` — host confusion GHSA-v2hh-gcrm-f6hx / GHSA-4c8g-83qw-93j6 — 3.1.2 → 3.1.4
- `js-yaml` — quadratic DoS GHSA-h67p-54hq-rp68 — gray-matter's 3.14.2 → 3.15.0 (3.x patched line; 4.2.0 instance left untouched)
- `linkify-it` — quadratic DoS GHSA-v245-v573-v5vm — 5.0.0/5.0.1 → 5.0.2

## Feedback Loop
- (none yet)

## Lots
- [x] Lot 0 — Branch + worktree + BRANCH.md
- [ ] Lot 1 — root `overrides` for the 4 HIGH advisories + `make lock-root`
- [ ] Lot 2 — prove `npm audit --audit-level=high` passes (API image build gate) + push + PR + CI green + merge

## UAT (owner)
- [ ] CI green on the PR (build-api-image, build-ui, typecheck-lint-api no longer red on the audit gate).
