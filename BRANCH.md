# Feature: Per-application forced MFA and recovery — IdP specification

## Objective
- Specify what the IdP needs so 2FA can be forced per application (first target KVM as `kvm-gateway`), with a recovery model that does not reduce forced-2FA applications to email security.

## Scope / Guardrails
- Scope limited to `spec/**` and `BRANCH.md` only.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/worktrees/idp-per-app-mfa-recovery` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Authored changes remain docs only: no code, deployment, publication, seed execution, or PR merge; the owner-authorized merge of `origin/main` is recorded as BR695-EX1.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `rules/**`
  - `api/**`
  - `ui/**`
  - `apps/**`
  - `e2e/**`
  - `packages/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [ ] No `blocked` / `deferred` / `cancelled` / `attention` item open; raise one here instead of guessing if a prerequisite is unresolved.
- [x] **BR695-EX1 — Main synchronization (owner-authorized, 2026-10-18):** Reason: merge `origin/main` at `eaddcf2de902f509aeb13c7d65680e6ba3c26dd0` after #699 without rebase or force-push. Impact: inherit upstream content unchanged outside `spec/**` and `BRANCH.md`; authored changes remain within those paths and are checked mechanically against the main parent. The pre-commit local scope check also sees upstream-only staged paths; its advisory findings do not authorize edits to those files. Rollback: revert the merge commit with its first parent selected; no history rewrite.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- [x] Not applicable on this docs-only branch: no API, UI, or E2E test run is claimed; future lane gates are specified inside the new spec.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single docs-only spec authoring with cross-references; future implementation lots are specified inside the new spec and are not branches of this work.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/idp-per-app-mfa-recovery`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/sentropic`, `ENV=dev`).
  - Switch back to `tmp/worktrees/idp-per-app-mfa-recovery` after UAT.
- [x] This branch has no UI change: UAT is an owner read of the new spec and cross-references on the draft PR; no service start and no `ENV=dev` test run.

## Plan / Todo (lot-based)
- [x] **Main synchronization after #699 (2026-10-18):** retain both policy cross-references and pin the merged refresh specification at `eaddcf2de902f509aeb13c7d65680e6ba3c26dd0`; refresh-spec bytes match the previously reviewed `0304357583e8af6e3e896da6d42b13cb4329d59f`. D-P1/D-P2/D-P3 quotes and section 15 are unchanged. `track events-contains` passes for both parents (342 events each); `.track` and every non-spec file match main. Branch C1 and main-parent-relative scope C2 pass; pre-commit `make scope-check` reports only upstream inherited paths under BR695-EX1. Whitespace checks pass; no runtime test or full-spec docs-UAT acceptance is claimed. PR #695 stays open.
- [x] **Owner decisions applied (2026-10-18), receipt**: close D-P1, D-P2 and D-P3 with verbatim answers from `.h2a/reviews/pr695_owner-decisions.md`; retain full-spec docs-UAT as a separate pending receipt.
- [x] **Owner decisions applied, freshness contract**: specify sliding browser continuity with an immutable 24-hour MFA deadline, downstream expiry, and PR #699's fifth-leg boundary; KVM remains authorization-code-only and refresh never upgrades evidence.
- [x] **Owner decisions applied, recovery and scope**: require two independent passkeys, the operator Job and pending-binding recovery codes in Lot 4 before protected activation; align schema, UI/API tests and full-loss drills; protect forced-2FA accounts only, with ordinary email recovery unchanged.
- [x] **Owner decisions applied, consolidation**: pin D-P1's 86400s bound and disabled OAuth refresh in the declaration/Lot 1 readback; verify all three exact answers, closed statuses, no stale optional-code references, and clean documentary diff. Scope checks: PASS C2; branch checks: PASS C1; no runtime test claim.
- [x] **Round 1 dossier treatment (2026-10-18), finding 7**: balance D-P3 account-security benefits and recovery costs; retain trust/recovery prerequisites and explain remaining non-MFA bearer-login exposure. Documentary verification against section 4.2; no product qualification claimed.
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `plan/BRANCH_TEMPLATE.md`, and the launch packet baseline at `94a38286e`.
  - [x] Confirm isolated worktree `/home/antoinefa/src/sentropic/tmp/worktrees/idp-per-app-mfa-recovery` on `spec/idp-per-app-mfa-recovery` with `git -C <worktree> branch --show-current`.
  - [x] Run `harness check branch` and record result.
  - [x] Confirm docs-only scope: verification is `make scope-check ENV=test-idp-per-app-mfa-recovery` with `ENV` last; no API, UI, or Maildev port is allocated or started.
  - [x] Confirm scope and guardrails: `spec/**` + `BRANCH.md` only, commits at most 150 lines via `make commit`, no AI attribution, draft PR only, never merge.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed: none required.
  - [x] Read merged baseline code and cite `file:line`: `packages/auth-hono/src/oauth/authorize-handler.ts`, `packages/auth-hono/src/oauth/session-resolver.ts`, `api/src/services/session-manager.ts`, `api/src/routes/namespaces/auth/magic-link.ts`, `api/drizzle/0042_oauth_clients_mfa_policy.sql`, `spec/SPEC_DECISION_TIER_AUTH_PATTERN.md`.
  - [x] Read neighbouring specs: `spec/SPEC_EVOL_AUTH_39E_MULTITENANT.md`, `spec/SPEC_EVOL_IDP_OAUTH_CLIENT_SYNC.md`, `spec/WORKFLOW_AUTH.md`, `docs/oauth-client-rotation.md`.
- [ ] **Lot 1 — Author `spec/SPEC_EVOL_IDP_PER_APP_MFA_RECOVERY.md`**
  - [x] Record given requirements: KVM registers as an OAuth client of the IdP; first client `kvm-gateway` (confidential, oauth2-proxy, PKCE S256, EdDSA, stated redirect/scopes/policy) is a given, not an option.
  - [x] Apply owner correction (2026-10-18, binding): the per-app requirement is a method-agnostic 2FA assurance level; WebAuthn with user verification is one qualifying method; express policy as a required MFA level with `amr` carrying the method.
  - [x] Evaluate `urn:sentropic:loa:passkey-fresh` as a method-named value, specify a method-neutral MFA ACR and a backward-compatible migration for existing clients including `kvm-gateway` created now with the only MFA ACR that exists today.
  - [x] Document verified baseline with `file:line` at `94a38286e`, including the email-to-new-passkey gap for accounts with and without devices.
  - [x] Specify threat model, per-client and per-account policy model, session satisfaction, freshness and step-up, downgrade rules; state that KVM relies on the IdP policy guarantee and that the RP checks only that signed `amr` contains `"mfa"`.
  - [x] Specify recovery and re-enrolment paths with assurance levels; evaluate kvm-lane options (a) two passkeys, (b) admin Job reset, (c) recovery codes at weak ACR, (d) no email-only recovery, and recommend one combination.
  - [x] Specify as normative requirements with file targets and lots: versioned non-secret `kvm-gateway` declaration, IdP non-regression test extending `packages/auth-hono/tests/oauth-client-required-acr.test.ts`, and closure/framing of the email-only re-enrolment path at `api/src/routes/namespaces/auth/magic-link.ts:194-226` with its effective lot; mark what already exists in merged code.
  - [x] Specify governance (who may change a client policy), audit and notifications, migration of clients and accounts, KVM onboarding, Netbird compatibility note.
  - [x] Specify test plan at file granularity and implementation lots for BUILD branches.
  - [x] List only real owner decisions, in French, with options and consequences at the end of the spec.
  - [x] Reconcile the parallel Astra max study (`.h2a/inputs/astra-idp-mfa-study.md`) into the spec when it lands; record each point taken or rejected with reason in `.h2a/reviews/spec-idp-mfa-reconciliation.md`.
  - [x] **API tests**: existing `none`, updated `none`, new `none` on this branch; future suites stay specified in the new spec test plan.
  - [x] **UI tests (TypeScript only)**: existing `none`, updated `none`, new `none` on this branch; future suites stay specified in the new spec test plan.
  - [x] **E2E tests**: existing `none`, updated `none`, new `none` on this branch; future suites stay specified in the new spec test plan.
  - [x] Lot gate: `make scope-check ENV=test-idp-per-app-mfa-recovery` passes with only `spec/**` + `BRANCH.md` changed; no typecheck, lint, build, or test claim is made for this docs lot.
  - [ ] UAT (docs read): owner reads the new spec and confirms the recommended recovery combination and the French owner-decision list.
- [x] **Lot 2 — Cross-references in related specs**
  - [x] Add a cross-reference from `spec/SPEC_DECISION_TIER_AUTH_PATTERN.md` to the new spec (per-client policy extended by recovery/freshness).
  - [x] Add a cross-reference from `spec/WORKFLOW_AUTH.md` to the new spec (device-loss and magic-link assurance for forced clients).
  - [x] Add a cross-reference from `spec/SPEC_EVOL_AUTH_39E_MULTITENANT.md` to the new spec (tenant claim unchanged; MFA/recovery is orthogonal).
  - [x] Check `spec/SPEC.md` for a SPEC_EVOL index and record the finding in this file; edit only if an index exists: no SPEC_EVOL index exists (only inline mentions), so no `spec/SPEC.md` edit is made.
  - [x] Lot gate: `make scope-check ENV=test-idp-per-app-mfa-recovery` passes; every new link resolves to an existing file in this branch.
  - [ ] UAT (docs read): owner follows each cross-reference to the new spec and back to the policy it extends.
- [x] **Lot N-1 — Docs consolidation**
  - [x] Confirm the new spec reuses merged mechanisms without duplicating them and contains no secret value, only variable names.
  - [x] Confirm `BRANCH.md` checkboxes reflect the completed lots with this commit.
- [ ] **Lot N — Final validation**
  - [x] Run `make scope-check ENV=test-idp-per-app-mfa-recovery` and record its result: PASS C2.
  - [x] Confirm every commit on this branch is at most 150 changed lines and was created with `make commit` without AI attribution.
  - [x] Push `spec/idp-per-app-mfa-recovery` and open a DRAFT PR whose body is this `BRANCH.md` text; report the PR number and head SHA, then stop without merging: DRAFT PR #695.
  - [x] Retest UI: not applicable, docs only, no UI test claimed.
  - [x] Retest API: not applicable, docs only, no API test claimed.
  - [x] Retest E2E: not applicable, docs only, no E2E test claimed.
  - [x] Package version bump: not applicable, no `packages/<pkg>/src/**` file changed.
