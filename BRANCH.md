# Feature: Close T3 operator driver gaps
## Objective
- [ ] Complete the reviewed applicability, preflight, rearm and restore contracts without cluster access.
## Scope / Guardrails
- [x] Worktree `tmp/worktrees/t3-gaps`, branch `fix/t3-driver-gaps`, base `938709b08`.
- [x] Tests `ENV=test-t3-gaps`; API 9165, UI 5365, Maildev 1265, checked free.
- [x] No cluster calls, secret values, Python, production or preproduction actions.
## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/ci/preprod-a4/**`
  - `deploy/k8s/overlays/preprod/a4-runtime/**`
  - `deploy/k8s/overlays/restore-a4/**`
  - `api/tests/api/t3-*`
  - `docs/runbooks/t3-*`
  - `.github/workflows/ci.yml`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
## Feedback Loop
- [x] BRT3-EX1: add scoped operator/PostgreSQL jobs to existing validate-idp-sync CI gate; impact limited to T3 validation, rollback removes the two steps.
- [x] SQL qualification detected ambiguous PostgreSQL internal-char concatenation in default ACL names; explicit text cast applied.
- [x] ACL mismatch now raises an SQL error inside the transaction, rather than relying on psql quit status; round-trip refusal rechecked.
- [x] Actual restore exposed global default ACL leakage during reload; reset inherited defaults before recreating objects, then replay original ACLs.
- [x] Capture initdb public-schema owner/ACL from the catalogue because pg_dump may omit it; verify exact parity.
- [x] Track single writer: conductor imports this branch plan and the final packet report; no concurrent `.track` writes.
- [ ] Operational P-0.1..9 and M-1..8 remain unverified; owner exception OD-T3-7 remains pending.
## AI Flaky tests
- [x] No AI tests or flaky allowances.
## Orchestration Mode (AI-selected)
- [x] Multi-branch: driver here, #1001 corrected on its own branch; no merge authorized.
## UAT Management (in orchestration context)
- [ ] Operator validates isolated restore namespaces, authentication and timing after code delivery.
## Plan / Todo (lot-based)
- [x] Lot 0: read packet, all four Astra reviews, merged driver and constraints; mechanical branch PASS.
- [ ] Lot 1: W0/W2/W5 stability gates wired; container-only actual legacy migration regression suite added.
- [ ] Lot 2: explicit Make maintenance entry points delivered; restore/rearm tests pending.
- [ ] Lot 3: fixture, namespace routing, ACL parser, restore SQL and rearm refusal regression tests added.
- [ ] Lot 4: v5 plan reconciliation, #1001 pins/switch, exact operator handoff.
- [ ] Final validation: focused operator and PostgreSQL tests on final bytes; PR and exact-head CI green.
- [ ] Review: independent code and design review evidence; no consensus claim without completed peers.
