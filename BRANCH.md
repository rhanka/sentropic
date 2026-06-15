# Fix: security deps refresh — clear `ws` HIGH (CVE-2026-48779) repo-wide

## Objective
A new HIGH advisory surfaced on the live npm DB (2026-06-15): **`ws` GHSA-96hv-2xvq-fx4p / CVE-2026-48779** (Memory-exhaustion DoS), affected `>=8.0.0 <8.21.0` — the repo had `ws@8.20.0`, patched in **8.21.0**. This trips the Dockerfile gate `npm audit --audit-level=high --omit=dev` → fails **build-ui-image** + **build-api-image** on EVERY fresh build, incl. main's next run (main was green at 10:42 before the advisory surfaced). Refresh the root lockfile so `ws→8.21.0`, unblocking CI repo-wide.

## Why a full lock refresh (not a targeted bump)
The repo's lock tooling cannot do a clean *targeted* bump (documented in #323): `make lock-root` (`--package-lock-only`) does not re-resolve an already-locked transitive against a new override; a hand-patched single entry is re-resolved away by `npm ci` (the committed lock has only 455/1429 entries with integrity → fragile). The only mechanism that lands `ws@8.21.0` is `rm package-lock.json && make lock-root` (fresh resolve), which also refreshes 215 other transitives to their latest **within-range** versions (@aws-sdk/*, @babel/*, …). Owner-approved (rhanka, 2026-06-15: "Refresh global contrôlé, CI-gated"). `package.json` is unchanged — declared ranges are untouched; only the resolved lock moves, all within existing semver ranges.

## Scope / Guardrails
- Make-only, Docker-first. `ENV=<env>` last.
- `package.json` UNCHANGED (no range changes). Only `package-lock.json` regenerated.
- CI is the gate: build + test-api + test-ui + e2e must validate the refreshed tree.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `package-lock.json`, `BRANCH.md`
- **Forbidden Paths**: everything else (`Makefile`, `docker-compose*.yml`, `package.json`, `api/**`, `ui/**`, `packages/**`, `.github/**`, `apps/**`)

## Plan / Todo
- [x] Identify the HIGH: `ws` 8.20.0 → patched 8.21.0 (CVE-2026-48779). Verified registry has 8.21.0.
- [x] Regenerate root lockfile (`rm package-lock.json && make lock-root`) → `ws@8.21.0` + within-range refresh of 215 transitives.
- [x] Verify gate locally: `make build-api-image` PASS (audit → "9 moderate, 0 high"); `make build-ui-image` (verifying).
- [ ] Final: PR (this BRANCH.md as body) → CI green (build-ui-image + build-api-image + test-api + test-ui + e2e validate the refreshed tree) → remove BRANCH.md → merge → unblocks repo-wide CI (main + all PRs, incl. consent #319).

## Feedback Loop
- FL-1 `note`: 9 moderate advisories remain (hono ×4, uuid via exceljs/gaxios, @nut-tree-fork/shared via js-yaml, …) — these do NOT trip `--audit-level=high`; left for a follow-up moderate sweep (some need `--audit-fix --force` = major bumps, out of scope for this unblock).
- FL-2 `ref`: #323 (the cross-cutting blocker) + the tooling-wall analysis. Closes #323 on merge.

## Deferred
- Moderate advisories sweep (hono major, uuid via exceljs/gaxios) — separate `fix/security-*` with contract review (hono is the api framework; major bump may be D11/ARCH-12-gated).
- Fixing `lock-root` to support targeted override re-resolution (foundations tooling).
