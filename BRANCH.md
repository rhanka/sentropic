# Fix: force proxy-addr 2.0.8 (GHSA-jqcg-44mw-7w3h)

## Objective
Fix critical advisory GHSA-jqcg-44mw-7w3h (proxy-addr < 2.0.8, IP spoofing) that fails the npm audit gate on fresh API image builds. Force proxy-addr to 2.0.8 via override + lock bump.

## Scope / Guardrails
- Scope limited to proxy-addr resolution: `api/package.json` override, `api/package-lock.json`, root `package-lock.json`, one-off make target.
- Make-only workflow, no direct npm/docker on host for lock changes.
- Never ENV=dev, never make clean-all. Test ENV: `test-proxy-addr` (API 9490, UI 5690, maildev 1590).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/package.json` (override, done by conductor)
  - `api/package-lock.json`
  - `package-lock.json` (root; Dockerfile + SCA gate resolve from it)
  - `BRANCH.md`
  - `.h2a/build/fix_report.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `.security/vulnerability-register.yaml` (no exception: a real fix exists)
  - `.security/audit-allowlist.json` (must be pristine at commit)
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` (BRPA-EX1, granted below)
- **Exception process**:
  - [x] BRPA-EX1 declared before touching Makefile (reason, impact, rollback below).

## BRPA-EX1 — one-off `lock-api-direct` make target
- [x] Reason: `lock-api` needs a running api service, but the api image build fails its own audit gate until the lock is fixed (chicken-and-egg); empty REGISTRY also breaks `up-api-test` image refs. A full npm regen is impossible (pre-existing ERESOLVE: registry llm-gateway@0.19.1 peerOptional jose@^5.10.0 vs top-level jose@6.2.3, reproduces with and without this branch's change). The 2.0.8 delta is 3 lines per lock (registry-pinned integrity), applied by the target with verification.
- [x] Impact: additive only (new target + two pinned-hash variables); no existing target behavior changed.
- [x] Rollback: delete the `lock-api-direct` block; locks remain valid without it.

## Feedback Loop
- [x] `attention`: npm from-scratch regen of the api tree is broken on main too (jose ERESOLVE) — needs its own branch, reported in fix_report.md, not fixed here.
- [x] `attention`: two fresh HIGH advisories published after main's last green security run (SDK GHSA-6qxp-vccf-f47h 2026-10-06, source-map-js GHSA-68fv-2mgg-jv7q updated 2026-10-05) still fail the gates on this branch AND on main — each needs its own dedicated branch per security discipline, not smuggled in here.
- [x] `acknowledge`: local image build used a TEMPORARY local-only SDK allowlist entry, reverted before commit (git diff verified). Final tree gates unmodified.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Branch `fix/proxy-addr-cve` confirmed; worktree root; base `52c1fdc63`.
  - [x] Override `"proxy-addr": "^2.0.8"` present in `api/package.json` (conductor).
  - [x] Diagnosed `up-api-test` image-ref failure: empty REGISTRY yields `/sentropic-api:...` — fixed invocation needs `REGISTRY=local`.
- [x] **Lot 1 — Lock fix**
  - [x] Added `lock-api-direct` (BRPA-EX1); `make lock-api-direct` reproduces the exact 6-line bump.
  - [x] proxy-addr 2.0.8 in `api/package-lock.json` and root `package-lock.json` (grep verified).
  - [x] `npm audit --workspace sentropic-api`: GHSA-jqcg-44mw-7w3h absent.
- [x] **Lot 2 — Verification gates**
  - [x] `make test-api-security-sca ENV=test-proxy-addr`: GHSA-jqcg-44mw-7w3h ABSENT; gate fails only on 2 pre-existing HIGHs (SDK GHSA-6qxp-vccf-f47h publ. 2026-10-06, source-map-js GHSA-68fv-2mgg-jv7q upd. 2026-10-05 — both newer than main's last green security run, each needs its own branch)
  - [x] `make typecheck` (exit 0) + `make lint` (exit 0, 0 errors / 207 pre-existing warnings), both `ENV=test-proxy-addr`
  - [x] Stack smoke: `up-api-test` healthy, `/api/v1/health` ok, runtime `proxy-addr` 2.0.8 in image; `make down ENV=test-proxy-addr` done, no test-proxy-addr containers remain
- [ ] **Lot 3 — Docs & delivery**
  - [ ] `.components/tech-debt-api.md`: no update (proxy-addr not tracked there)
  - [ ] Commit via `make commit` (no AI attribution), push, open PR to main
  - [ ] CI watch; stop at open PR (no merge)
  - [ ] `.h2a/build/fix_report.md` written
