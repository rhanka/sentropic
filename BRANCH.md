# Fix(sec): bump vitest 4.0.18 -> 4.1.0 (clear GHSA-5xrq-8626-4rwp) — unblock api-image audit

## Objective
- [x] Clear the CRITICAL vitest advisory `GHSA-5xrq-8626-4rwp` (CVSS 9.8) that reds the api-image npm-audit gate for ALL PRs (found repo-wide by the #526 build-review; inherited from main, not #526's).
- [x] Real fix (not an exception): the only vulnerable vitest in the tree was `4.0.18` (packages/focus, packages/harness, packages/skills). The advisory is fixed in 4.1.0 (4.x) / 3.2.6 (3.x). ui is already 3.2.7, api 4.1.5, 18 packages 4.1.0 — all fixed.

## Scope / Guardrails
- [x] Bump the 3 vulnerable `"vitest": "4.0.18"` devDeps to `"4.1.0"` — the version 18 other packages already run (proven in-repo).
- [x] Regenerate root `package-lock.json` (`make lock-root`): no vitest `4.0.18` remains -> advisory matches nothing -> gate passes with NO exception added.
- [x] No new allowlist entry, no Dockerfile change. Dev-only test tool bump; zero runtime/API change.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `packages/focus/package.json`, `packages/harness/package.json`, `packages/skills/package.json`, `package-lock.json`, `BRANCH.md`
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `api/src/**`, `ui/src/**`, `packages/*/src/**`, `.security/**`
- **Conditional Paths**: none.

## Feedback Loop
- [x] `SEC-VITEST-RCA` — GHSA-5xrq-8626-4rwp affects vitest (arbitrary file read on Windows when the Vitest UI server is exposed to network), fixed in 4.1.0 / 3.2.6. Only `4.0.18` (focus/harness/skills) was vulnerable; the rest of the tree is already >= 4.1.0 / 3.2.7.
- [x] `SEC-VITEST-VERIFY` — `make build-api-image` green: `audit-gate: OK` (api base + production), no vitest advisory remains (only the pre-existing image-size allowlist from #519), api image `Successfully built`.
- [ ] `SEC-VITEST-CI` — PR CI must confirm the focus/harness/skills test suites pass on vitest 4.1.0 (non-breaking) before merge.
- [ ] `SEC-VITEST-SYSTEMIC` — NOTE for a separate follow-up: dev-only tooling (vitest) trips the prod-image `npm audit --omit=dev --workspaces` gate because npm's `--omit=dev` does not exclude workspace devDeps. Future dev-tool advisories will recur; the real hardening is making the gate exclude workspace devDeps (or the wrapper distinguishing dev-only). Out of scope for this urgent unblock.

## AI Flaky tests
- Not applicable: devDependency version bump only.

## Orchestration Mode (AI-selected)
- [x] Mono-branch + cherry-pick.
- [ ] Multi-branch.
- Rationale: one atomic security devDep bump; real fix, no exception.

## Plan / Todo (lot-based)
- [x] Lot 0 — RCA: only vitest 4.0.18 (3 packages) vulnerable; 4.1.0 is the repo standard + a fixed version.
- [x] Lot 1 — Bump the 3 pins to 4.1.0; regen root lockfile; confirm no 4.0.18 remains.
- [x] Lot 2 — Verify api-image audit green via `make build-api-image`.
- [ ] Lot 3 — PR CI green (gate + package tests) -> merge -> report api-image audit green on main to conductor.
