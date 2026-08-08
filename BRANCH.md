# Feature: General Cowork computer-use foundation

## Objective
Build only ratified General Cowork Lots 1–2: a durable, fail-closed authorization protocol, C1 broker seam, lease v2, device/PEP proof, and honest durable outcomes. No input execution, consent UI, native PEP, global STOP, VM containment implementation, audit UI, or qualification is included.

## Scope / Guardrails
- Source of truth: `spec/SPEC_EVOL_COWORK_COMPUTER_USE_GENERAL.md` and `/home/antoinefa/src/sentropic/tmp/COWORK_CU_GENERAL_RATIFICATION_archi.md`.
- Characterized BR-41c: identity/presence are durable; `cowork_device_leases` is v1-only, unsigned, and its ack signs only `leaseId.nonce`; bearer-owned poll/SSE has no proof-of-possession.
- C1–C6 and BC-1–BC-7 are invariants. D2 model fields are `ASSERTED_UNTRUSTED`; unknown/sensitive/unsigned/unenclosed paths fail closed to `PAS-FAIT`.
- One migration maximum: `0042_cowork_general_foundation.sql`; it is required for durable calls and General-only device profile/PEP identity.
- Make-only build/test commands use `ENV=test-cowork-cu-general` last; never `ENV=dev`. No push.
- Work only on `feat/cowork-cu-general-spec`; check `harness check branch` before work and `make scope-check` before every commit.
- Lots 3–8 (native/browser PEP, consent UI, STOP, containment/egress, audit surface, qualification) are explicitly not built and remain hard gates.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/db/schema.ts`
  - `api/drizzle/0042_cowork_general_foundation.sql`
  - `api/src/services/cowork/**`
  - `api/src/services/connector-host/cowork.ts`
  - `api/src/routes/api/chrome-extension.ts`
  - `api/src/routes/api/streams.ts`
  - `api/tests/api/cowork-general-*.spec.ts`
  - `api/tests/unit/cowork-general-*.test.ts`
  - `api/tests/utils/cowork-device.ts`
  - `packages/connector-host/src/**`
  - `packages/connector-host/tests/**`
  - `packages/connector-host/package.json`
  - `reviews/cowork-general-foundation/**` (BR-CU-GENERAL-EX1 only)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `.cursor/rules/**`
  - `api/src/routes/api/mcp.ts`
  - `api/src/index.ts`
  - `packages/cowork-desktop/**`
  - `packages/cowork-bridge/**`
  - `ui/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare a `BR-CU-GENERAL-EXn` entry in `## Feedback Loop` with reason, impact, rollback, and approval before touching a conditional or forbidden path.

## Feedback Loop
- `attention`: `docs/governance/surface-invariants.md` is cited by the ratification as h2a PR #152, but is absent from the declared cross-repository path. The I1–I5 contract is encoded from the ratified spec; no local publisher check is claimed.
- `attention`: BC-4 global STOP, BC-5 egress enforcement, BC-6 signed allowlist-change governance, and BC-7 qualification are later-lot gates. This foundation supplies only their fail-closed seams and never executes an action.
- `acknowledge`: BR-CU-GENERAL-EX1 permits `reviews/cowork-general-foundation/**` solely for the mandatory harness review dossier and two immutable peer-leg artefacts; impact is review evidence only and rollback is removal before merge.
- `blocked`: C3/C4/C5b are remediated in source and have deterministic regression suites, but both scoped API commands remain blocked with `service "api" is not running` after the permitted normal and CI-style test-stack bootstraps. Under the ratification STOP-don't-weaken condition, Lots 1–2 remain unaccepted and this branch must not merge or feed later lots until that execution evidence is green.

## AI Flaky tests
- No AI-dependent test is in scope. Any non-deterministic failure remains blocking unless recorded here with the exact command and an explicit owner sign-off.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: protocol, persistence, delivery proof, and the connector seam form one transactionally coupled authorization boundary.

## UAT Management (in orchestration context)
- No UI or execution UAT is authorized in Lots 1–2. Automated tests are run only in `ENV=test-cowork-cu-general`; later contained-target UAT belongs to Lots 3–8.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline, branch, and ratified constraints**
  - [x] Verify `feat/cowork-cu-general-spec` with `harness check branch`.
  - [x] Characterize BR-41c identity/presence/lease/poll/SSE and the existing OAuth signing-key port.
  - [x] Read General §2/§4/§6/§7 and the seven binding conditions.
  - [x] Record C1–C6, BC-1–BC-7, I1–I5, and the explicit Lots 3–8 exclusions.
- [ ] **Lot 1 — Durable protocol and C1 connector broker seam — blocked by review**
  - [x] Add trusted invocation context and Cowork adapter/factory; a fresh closure is keyed by `toolCallId`, contains no mount state, and returns deny-as-missing when tenancy/workspace/device/exposure checks fail.
  - [x] Add typed `ASSERTED_UNTRUSTED` model payload quarantine, human-only target selection, immutable action descriptor, sensitive-class receipt requirement, signed-PEP prerequisite, and containment/egress seams.
  - [x] Add unit tests for C1 concurrent isolation/idempotency, tenant/workspace/device isolation, deny-as-missing, C2 target selection, D2 quarantine, BC-2/BC-3/BC-5 fail-closed gates.
  - [x] Gate: `make typecheck-connector-host ENV=test-cowork-cu-general`; `make test-connector-host ENV=test-cowork-cu-general`; scoped API unit tests are present but unavailable because the `api` service is absent.
- [ ] **Lot 2 — Lease v2, device proof, and durable DÉPOSÉ — blocked by review**
  - [x] Add `0042` and General-only device PEP/containment metadata plus durable calls; reuse lease JSONB for canonical v2 envelope and ack metadata.
  - [x] Sign canonical v2 envelopes through the existing JWKS signing-key port; enforce `kid` rotation overlap, reject v1 for General, and require device/PEP PoP on poll/SSE/wake/ack/result.
  - [x] Implement atomic issue/ack/consume/revoke/expire and revoke-before-cascade tombstone; keep FAIT/DÉPOSÉ-EN-ATTENTE/PAS-FAIT durable and mutually exclusive.
  - [x] Add API suites for v2 vectors/tamper/wrong kid/device, all proof channels, deposit durability/wake freshness, I5, and revoke/tombstone ordering; atomic conditional transitions provide the replay/race seam.
  - [x] Gate: `make typecheck-api ENV=test-cowork-cu-general`; connector-host, bridge, and desktop type/test gates pass. The scoped API unit/protocol suites remain blocked because the `api` service is not running after permitted stack bootstrap.
- [ ] **Lot 3 — Final foundation verification**
  - [x] Inspect each hunk and record the mandatory two-peer review evidence.
  - [ ] `make scope-check` passes, but acceptance reporting remains blocked until the C3/C4/C5b scoped API regressions run green on an available API service.
  - [ ] Do not state the no-bypass acceptance claim until both review findings are remediated and retested.
