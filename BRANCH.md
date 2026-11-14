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
  - `deploy/k8s/components/a4-wiring/patch-auth-idp-a4.yaml`
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
- [x] Added complete offline preflight and successful rearm regression, including archive-before-erasure ordering.
- [x] Emit four individual encrypted-store fingerprints alongside the aggregate; SQL mutation coverage includes all four stores.
- [x] Operator test files run serially to avoid competing process supervisors on the shared host; process-deadline assertions are unchanged.
- [x] Read-only qualification Make utility exposes exact RBAC, baseline capture and inert fixture generation commands for OPERATOR.
- [x] Review hardening: validate excluded observer and witness URLs as fixture-only, require nonexpired legacy witness, retain sentropic-app SA and correct TEM endpoint key.
- [x] Offline preflight now validates every annex action through the same command validator used at execution, before the first fence mutation.
- [x] Removed cold Node startup overhead from the kubectl test double; actual process supervisors, hostile descendants, deadlines and all assertions remain exercised.
- [x] R1: canonical effective ACLs sort grantor/grantee/privilege/delegation and normalize implicit defaults; restore fixture now includes reader USAGE on public.
- [x] R2: tar must succeed and validate before transfer; gzip CRC and remote SHA must match before archive persistence and custody erasure.
- [x] R5: offline authorization-code PKCE challenge contributes its own SHA; same-length challenge-only SQL mutation changes applicability.
- [x] R5-B1: armed CLI delegates recovery immediately to the watchdog; no 60-second attempt precedes the full-budget recovery. Composite T+174s regression added.
- [x] R5-B2/M3: bind original rehearsal and P-0 baseline to the annex policy; derive the final fenced receipt only after applicability/ACL equality and preserve both originals.
- [x] W5 now validates applicability and ACLs before staging its derived receipt; driver doubles use a real original/fenced receipt pair.
- [x] Added regressions for session-only seven-hash rebasing, ACL drift before staging, missing annex actions and partial/corrupt custody archives.
- [x] SQL canonicalization treats zero-dimensional empty ACL arrays as no entries before aclexplode.
- [x] R5-B3/M2: fixture preserves the immutable logical WebAuthn verifier; W3 explicitly wires the dedicated IdP JWT Secret, including legacy templates.
- [x] R5-M4: human emergency passes the protected witness configuration; successful classified rollback persists DONE/commitVerified=false for rearm.
- [x] R5-M1: preflight requires both excluded-source 403 probes; finish-open executes them before acceptance and requires configured final external probes.
- [x] Qualification usable-auth reads both real authenticated /me responses after reopening, checks expected user IDs and records monotonic elapsed/fault-to-auth against final state; health alone cannot qualify.
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
