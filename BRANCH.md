# Fix(sec): exception-aware npm-audit gate — unblock ui/api Docker builds

## Objective
- [x] Lift the repo-wide `--audit-level=high` Docker gate that reds every ui/api build (blocks all ui lanes + PR CI).
- [x] Root cause: `image-size` (GHSA-w3rx-r6r6-pgpr + GHSA-5p2g-fcmc-qvqq, DoS parsers) pulled transitively by `pptxgenjs@4.0.1` in the ROOT lockfile. `#517` (mermaid in `ui/package-lock.json`) is a NO-OP — the Docker build audits the ROOT lockfile; mermaid is only moderate anyway.
- [x] No forward fix exists (`image-size <= 2.0.2` all vulnerable, `first_patched_version = null`), and the DoS is unreachable in sentropic → a targeted, expiring audit exception is the right unblock.

## Scope / Guardrails
- [x] `.security/audit-gate.mjs` (new) + `.security/audit-allowlist.json` (new): exception-aware wrapper — fails on any HIGH/CRITICAL GHSA not allowlisted, and fails after `review_due`.
- [x] `.security/vulnerability-register.yaml`: `false_positive` entry for the 2 GHSAs (human record).
- [x] `api/Dockerfile` (base + production gates) + `ui/Dockerfile` (base gate): replace raw `npm audit` with the wrapper. `api/Dockerfile:99` (auth-idp/web sub-tree, no image-size) left as raw audit.
- [x] No `package.json` / lockfile change (npm ci stays valid). mermaid override bump DEFERRED (needs a full lockfile regen; moderate/non-blocking) — fast-follow.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `.security/audit-gate.mjs`, `.security/audit-allowlist.json`, `.security/vulnerability-register.yaml`
  - `api/Dockerfile`, `ui/Dockerfile`, `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `package.json`, `package-lock.json`, `api/src/**`, `ui/src/**`, `packages/**`
- **Conditional Paths**: none.

## Feedback Loop
- [x] `SEC-IMGSIZE-A` — RESOLVED. Option A (forward override) is IMPOSSIBLE: no patched image-size exists (`<= 2.0.2` vulnerable, `first_patched=null`, latest 2.0.2). Confirmed by cyber (gh api /advisories + npm registry) and infra (GitHub advisories). Conductor decision A/B/C: A preferred if a patch exists, else B (expiring exception), C (breaking pptxgenjs downgrade) REJECTED.
- [x] `SEC-IMGSIZE-B` — Reachability NULL, double barrier (verified): (1) pptxgenjs@4.0.1 never imports image-size — dead declared dep (commented `FIXME: currently unused` consumer, `browser:{image-size:false}`); (2) sentropic passes no image bytes — no `addImage` in the repo, pptx surface = text/shape/table, backgrounds color-only. The CVSS 7.5 DoS on attacker-image parsing has no reachable path → `false_positive`.
- [x] `SEC-IMGSIZE-VERIFY` — `make build-ui-image` green: `audit-gate: OK — only allowlisted HIGH/CRITICAL remain`, full ui build `Successfully built`.
- [ ] `SEC-IMGSIZE-EXPIRY` — exception `review_due` 2026-09-08. Follow-up: upstream pptxgenjs issue to drop the dead image-size dependency, then remove the exception.
- [ ] `SEC-IMGSIZE-MERMAID` — DEFERRED fast-follow: bump the `mermaid` root override `^11.15.0 -> ^11.16.1` (clears the moderate mermaid advisory) via a dedicated delete-lockfile regen. Moderate, non-blocking, out of this urgent unblock.

## AI Flaky tests
- Not applicable: security-gate + Dockerfile change only.

## Orchestration Mode (AI-selected)
- [x] Mono-branch + cherry-pick.
- [ ] Multi-branch.
- Rationale: one atomic security-gate change; conductor holds the merge GO.

## Plan / Todo (lot-based)
- [x] Lot 0 — RCA: gate = 4 Dockerfile lines audit the ROOT lockfile; #517 no-op; blocker = image-size HIGH.
- [x] Lot 1 — Build the exception-aware wrapper + allowlist + register entry; wire the 3 real gates.
- [x] Lot 2 — Verify via `make build-ui-image` (REGISTRY=local): gate passes, build green.
- [ ] Lot 3 — Handover: draft PR; merge on conductor GO; report main-green to conductor + chat; open the pptxgenjs upstream follow-up.
