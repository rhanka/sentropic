# Fix: clear `ws` HIGH (CVE-2026-48779) + stabilize file-type resolution

## Objective
A HIGH advisory surfaced on the live npm DB (2026-06-15): **`ws` GHSA-96hv-2xvq-fx4p / CVE-2026-48779** (Memory-exhaustion DoS), affected `>=8.0.0 <8.21.0` — repo had `ws@8.20.0`, patched in **8.21.0**. It trips the Dockerfile gate `npm audit --audit-level=high --omit=dev` → fails **build-ui-image** + **build-api-image** on EVERY fresh build (incl. main's next run). Bump `ws→8.21.0` to unblock CI repo-wide.

## Why this shape (root-cause investigation, see #323)
The repo's lockfile is **integrity-incomplete (974/1429 entries lack `integrity`)** → `npm ci` re-resolves those entries at install time, so a *targeted* hand-patch of `ws` is unstable (other HIGHs like `js-yaml` surface). The only deterministic mechanism is a **full lock re-resolve** (`rm package-lock.json && make lock-root`), which pins everything (ws→8.21.0 + ~215 within-range transitive refreshes). BUT a naive re-resolve **re-hoists** `node_modules/file-type` from 22.0.1 → 16.5.4 (because two majors exist: `officeparser@^22`, `@jimp/core@^16`; the api imports the *hoisted* file-type, breaking `document-text.ts` + its BUG-3 unit test). **Fix:** the api now **declares `file-type@^22.0.1` directly** → 22 dominates → hoists to root (matching origin/main's layout), @jimp keeps its nested 16.5.4. Owner-approved global-refresh approach (rhanka, 2026-06-15). `ws` override added to pin the security floor.

## Scope / Guardrails
- Make-only, Docker-first. CI is the gate.
- Changes: root `package.json` (`ws` override floor), `api/package.json` (declare `file-type@^22` — fixes the implicit-hoist fragility), `package-lock.json` (re-resolve). No app *code* changed.

## Branch Scope Boundaries
- **Allowed**: `package.json`, `api/package.json`, `package-lock.json`, `BRANCH.md`
- **Forbidden**: everything else (`Makefile`, `docker-compose*.yml`, `ui/**`, `packages/**`, `api/src/**`, `api/tests/**`, `.github/**`, `apps/**`)

## Plan / Todo
- [x] Identify HIGH: `ws` 8.20.0 → 8.21.0 (CVE-2026-48779).
- [x] Root-cause the lock fragility (integrity-incomplete) + the file-type re-hoist (#323).
- [x] Fix: re-resolve lock + `ws@^8.21.0` override + `api` declares `file-type@^22.0.1` (root file-type back to 22.0.1, @jimp nested 16.5.4 — matches origin/main).
- [x] Verify locally: `make build-api-image` PASS (prod audit → 0 high) + `make build-ui-image` PASS (verified on the prior re-resolve).
- [ ] Final: PR (this BRANCH.md as body) → CI green (build images + test-api incl. the file-type docx unit test + test-ui + e2e validate the refreshed tree) → remove BRANCH.md → merge → unblocks repo-wide CI + consent #319. Closes #323.

## Feedback Loop
- FL-1 `note`: 8–9 *moderate* advisories remain (hono ×4, uuid via exceljs/gaxios, js-yaml/@nut-tree-fork) — they do NOT trip `--audit-level=high`; deferred to a moderate sweep (some need major bumps / contract review).
- FL-2 `note`: the integrity-incomplete lock is a foundations lock-health debt — a future `lock-root` that re-resolves overrides (or a one-time integrity-complete regen) would make targeted bumps possible without a full refresh.

## Deferred
- Moderate advisories sweep (hono major bump = D11/ARCH-12 review; uuid via exceljs/gaxios).
- Foundations: fix lock-maintenance tooling (targeted bump support).
