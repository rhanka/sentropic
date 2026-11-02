# Feature: app-cm-a4 — consolidated app identity cutover (A4.1+A4.2+A4.3)

## Objective
One lot: migrate app identity data (users, proofs, invitations, login sessions, tenants, both memberships, workspaces) into the cluster-mesh stores, switch the single author under the r13 D11 protocol with the rollback checkpoint recorded before any legacy table deletion, point every reader/writer at the CM stores, delete the legacy app identity tables/files, replace request-authority with F15, and land the F11 screens.

## Scope / Guardrails
- Scope limited to the app cutover: api identity read/write paths, one control data migration, ui F11 screens, e2e.
- One migration max: `api/drizzle/control/0014_app_cm_identity_cutover.sql` (control stream).
- Make-only workflow, no direct Docker commands; Docker under the packet flock; `make down ENV=<env>` after.
- Branch development in isolated worktree `tmp/worktrees/app-cm-a4-3` on branch `feat/app-cm-a4` from `origin/feat/cm-identity-a2-0b` (code against the A2.0b contract; missing A2.0b APIs are stack dependencies, recorded in the report, not implemented here).
- Test campaigns on `ENV=test-app-a4` / `ENV=e2e-app-a4` (ENV last), never root dev.
- All new text in English.
- No dual writer, no legacy fallback; the app keeps business data only.
- Pins: A2-lots.md sha256 015d821d066a6bcc368113adf3fa45dd73a32abebc2f37cedb5f4eb1ced8c0c2; r2.md (APPROVED) sha256 f24480ee9e39396c2ecfb71be790e2a5a247976be15980a18b185101542cd518; A2.0b amendment r6 sha256 5bde078cd12a35fb752eadb48496f0373dc8940883c701b920878a165; owner-answers-20261030.md sha256 01554c2f81d88f1c96815b5e4a60e7f5c91ad51622d637ca83af5422a578c1c7 (Q-G answered 2026-11-01: interim accepted); gap.fr.md; STOP reports .tmp/rv/lot-A4-2.md and .tmp/rv/lot-A4.2.md; base origin/feat/cm-identity-a2-0b.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/**`
  - `api/tests/**`
  - `api/vitest.config.ts`
  - `api/drizzle/control/0014_app_cm_identity_cutover.sql` + `api/drizzle/control/meta/**`
  - `ui/src/**`
  - `ui/tests/**`
  - `e2e/tests/**`
  - `packages/cluster-mesh/ui/**`
  - `packages/cluster-mesh/tests/ui/**`
  - `packages/cluster-mesh/package.json`
  - `ui/package.json` + `ui/package-lock.json`
  - `package-lock.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/cluster-mesh/src/**` (A2.0b owns backend contracts/implementation; gaps remain stack dependencies)
  - `packages/cluster-mesh/tests/identity/**`
  - `.github/workflows/**`
  - `spec/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` public stream (not used; control stream only)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [x] A4-TEST-POLICY — Declare the API Vitest configuration for synthetic fixture policy only; production Q-K remains required. The first C2 check flagged this previously undeclared path but exited zero, and commit 3f587bf61 proceeded. The declaration is corrected here; subsequent gates must inspect PASS text as well as the exit status. Rollback: revert the test env entry; no production configuration changes.
- [x] BRxx-EX1 — Approved r2 F11 requires CM-owned screens. Allow only `packages/cluster-mesh/ui/**`, `tests/ui/**`, its browser exports/optional peer metadata, and root/UI lock/dependency entries needed to mount them. Backend CM source/tests stay excluded. Impact: one shared screen behavior across root projections; publication/version validation is required after rebase. Rollback: revert the UI projection/package commits together before activation; no data or A2.0b branch changes.
- [ ] A4-STACK — A2.0b owner: supply the approved r6 combined UOW (`run`, `tx.stores`, `tx.custody`, subject lifecycle), auth-hono binding/runner, importer verifier and V2 planes before app qualification; A4 does not implement these CM APIs.
- [ ] A4-WORKSPACE-DELETE — CM has no standalone workspace deletion contract. The app endpoint now refuses after its existing authorization/hidden guards, with zero writes; restore its 204 contract only through an approved atomic CM cleanup API. Existing success acceptance remains unmet (Mistral M1).
- [ ] A4-QK — Deployment custodian: record the explicit email-code protection choice before the author switch; no secret or default choice is inferred.
- [x] A4-OWNERSHIP — r6 §5.3 requires business-authorized ownership. Preserve `public.workspaces.owner_user_id` solely for destruction policy; CM owns membership/tenant access. Membership never substitutes for ownership. Rollback uses the recorded source checkpoint.
- [x] A4-CONVERSATION — Business chats retain an opaque CM authority reference. Verified HTTP admission opens a separate seven-day conversation lifetime; login expiry/logout never renews or revokes it. Revoked/expired records cannot be reopened. Workspace adoption must revoke/clear the prior binding.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single consolidated lot; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: conductor decision 2026-10-31T22:57Z consolidated A4.1+A4.2+A4.3 into ONE lot (tables interlinked; splitting failed twice: .tmp/rv/lot-A4-2.md, .tmp/rv/lot-A4.2.md). Stacked on feat/cm-identity-a2-0b; draft PR with base feat/cm-identity-a2-0b while A2.0b is open; rebase onto origin/main after A2.0b merges; one CI run on the final head.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- F11 screens land in this lot; e2e on ENV=e2e-app-a4 covers them.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read COMMON-RULES, MASTER, A2-lots, r2 §5/§9.3, gap.fr.md, STOP reports, A2.0b r6, owner answers (Q-G recorded), workflow.
  - [x] Worktree `tmp/worktrees/app-cm-a4-3`, branch `feat/app-cm-a4` from origin/feat/cm-identity-a2-0b head; harness C1 PASS.
  - [x] BRANCH.md from plan/BRANCH_TEMPLATE.md.
  - [x] ENV mapping: test-app-a4 / e2e-app-a4; ports API_PORT=9640 UI_PORT=5840 MAILDEV_UI_PORT=1740.
  - [x] Resume C1 PASS; review inherited account, challenge and invitation fixtures; restore original email data.
  - [x] Review inherited session, magic-link and WebAuthn fixtures without weakening assertions.
  - [x] Add real CM WebAuthn coverage for persisted COSE, options policy, counter/challenge atomicity, replay, expiry, purpose/owner binding and stale signed counters; replacement execution awaits A2.0b.
  - [x] Correct CM fixture cleanup for indirect session, operation, invitation and outbox references.
  - [x] Correct control-schema custody cleanup, conversation/escalation fixture references and the synthetic test-only email policy; remove a false null-email migration claim from registration coverage.
  - [x] Review session-adoption setup and tenant-bound authorization fixtures against CM stores.
  - [x] Make authenticated fixtures explicitly seed their tenant approval, business ownership and admin workspace membership; production registration still grants no tenant approval.
  - [x] Review remaining adoption race/role fixtures and LLM identity directory fixtures against CM stores.
  - [x] Preserve OAuth refresh revocation assertions during CM fixture conversion.
  - [x] Review document, history, stream and lock fixture conversions; preserve original email values.
  - [x] Port chat-service-tools.test.ts to CM identity fixtures and explicit conversation admission where needed; retain business assertions.
  - [x] Port chat-service-tab-tools.test.ts to CM identity fixtures and explicit conversation admission where needed; retain business assertions.
  - [ ] Docker stack under flock, `make down ENV=test-app-a4` after.
- [ ] **Lot 1 — CM identity composition + one data migration**
  - [ ] App-side CM identity composition (core stores, tenancy stores, custody host/UOW, F15 producer, atomic deletion V2, importer) over the app Postgres.
  - [x] Bind the r6 combined UOW to one app PostgreSQL connection, including indeterminate-commit refusal.
  - [x] Join account/profile registration and partial updates to the active combined UOW; refuse absent profiles.
  - [ ] Control migration 0014: CM identity schema + id-preserving copy of users/proofs/invitations/login sessions/tenants/memberships/workspaces + rollback checkpoint row; journal integrity test passes.
  - [ ] Migration tests (both directions of the copy, id preservation, counts).
  - [x] Add isolated PostgreSQL cutover tests for checkpoint retention, rollback and OAuth invalidation.
  - [x] Add a protected synthetic snapshot fixture for actual bound-import tests; its evidence is explicitly excluded from operational rehearsal receipts.
  - [x] Make successful migration and rollback tests call the actual bound importer before SQL deletion; retain the SQL-only refusal test separately.
  - [x] Add import mapping regressions for expired approval, null email, terminal proofs, credential counters and login lineage.
  - [x] Map account/profile, credential, single-use proof and login source fields to the r6 import records without invented history.
  - [x] Map invitations, signature-verified email continuations and social links; refuse prohibited provider secrets.
  - [x] Map tenant/workspace directories, independent memberships and OAuth tenant bindings through their frozen records.
  - [x] Extract the locked source inventory and assemble one typed batch; refuse live federation flows and non-null social secrets.
  - [x] Check the exhaustive removed-column inventory and hash the shipped mapping with pinned RP/origin policy; trace historical metadata to the protected checkpoint.
  - [x] Map pending settings revocations to one deterministic CM delivery group per legacy intent, preserving every target and refusing unknown ownership.
  - [x] Verify the protected remote snapshot digest, reconcile SQL/file tuples and refuse live orphan or divergent file authority.
  - [x] Account for every legacy connector event through captured or unresolved records; move metadata invitations to the digest representation.
  - [x] Load pinned migration assets, verifier policy, protected snapshots and borrowed token keys before transaction entry.
  - [x] Apply the canonical CM asset and bound importer/custody verifier on the control migration connection, recording D11 before any legacy-row deletion.
  - [x] Invoke the typed import from the real control migration runner on its SERIALIZABLE connection; dispose keys after success or rollback and skip completed journals.
  - [x] Delete the manually copied CM core/custody DDL from control migration 0014; the canonical package asset is its schema source.
  - [x] Delete copied tenancy/enforcement DDL; bootstrap the merged CM schemas through their shipped statement exports.
  - [x] Delete the raw identity copy SQL and guessed lifecycle/expiry/revision mappings; the typed importer is the only migration writer.
  - [x] Delete the SQL count-only checkpoint; keep the protected-source D11 checkpoint and real import receipt from the bound runner.
  - [x] Rebind actual business foreign keys to CM while preserving delete/update/deferral actions; refuse unrepresentable references and record the inventory.
  - [x] Preserve the existing business workspace owner reference and set it on new personal/business workspace rows.
  - [x] Preallocate auth entity/workspace id hints outside transaction entry and keep them stable across whole-callback retries; remove locking of a nonexistent workspace.
  - [x] Add real PostgreSQL host-scope probes for backend/transaction identity, expired handles, swallowed failures, nested control and unawaited queries.
  - [x] Reject commented transaction commands and use the driver's single-statement extended protocol; real PostgreSQL regressions await execution.
  - [x] Bind app SQL to expiring host capabilities, refuse nested transaction control and rethrow caught driver failures before publication/commit.
  - [x] Refuse SQL-only cutover without the real importer/checkpoint; remove fabricated schema and import attestations.
  - [x] Require protected D11 checkpoint evidence, verify snapshot/asset digests and keep backup paths out of durable receipts.
  - [x] Add production custody-envelope regressions for absent/empty v1 configuration, AAD corruption, fresh nonce and buffer disposal.
  - [x] Borrow the unchanged v1 derived key for HKDF-separated connector custody; add authenticated envelopes with owned-buffer disposal.
  - [x] Define the host control-schema custody contribution and strict minimal-capability/envelope codecs; retain bounded long capabilities.
  - [x] Verify custody against the actual pending/delivered CM outbox tuple and erase only the acknowledged envelope on its transaction.
  - [x] Capture source connectors on the active host connection with independent owner/scope checks and exact replay comparison.
  - [x] Bind the V2 connector plane to the full owner-or-deleted-workspace union, retaining actual owners and verifying every enqueued custody reference before commit.
  - [x] Add the CM leased delivery drain with short claim/ack/release transactions and atomic custody erasure; network delivery stays outside callbacks.
  - [x] Drain the CM ledger on periodic sweeps and delete the replaced settings queue/pending/ack module.
- [ ] **Lot 2 — Author switch (r13 D11) + reader/writer cutover**
  - [x] Preserve credential/session HTTP refusal shapes after rollback and reject malformed completion status; regression execution remains pending.
  - [ ] /auth + /session over CM custody stores (auth-hono ports backed by CM); delete registration.ts, account.ts, session-manager identity paths.
  - [x] Add social-completion regression cases for whole-attempt retry, fresh linking-session checks and no SQL after an insert conflict.
  - [x] Require a completion boundary in the federation broker contract; isolate the in-memory resolver adapter in protocol test fixtures.
  - [x] Resolve social sign-in and mint its session through per-attempt CM capabilities; recheck the pinned assertion deadline on retry.
  - [x] Remove manual-link catch-and-reread; revalidate the current link actor each attempt and consume email-challenge proof inside the same completion.
  - [x] Mount CM social completion with current session/eligibility checks and atomic email-ticket consumption; remove root-pool social user/workspace/session writes.
  - [x] Preserve the upstream evidence deadline through email challenge and test expired retries and ticket-consume failure before login publication.
  - [x] Retain only verified OIDC expiry evidence for retry and reject missing/malformed expiry; remove raw upstream error text from federation audit events.
  - [x] Remove the standalone federation identity writer and unsafe conflict translation; root federation ports retain only transient protocol flow storage.
  - [x] Delete obsolete federation conflict helpers and root OAuth session/ticket signing and verification; only the CM binding supplies those capabilities.
  - [x] Delete root OAuth user/profile/proof adapters; request-bound CM adapters are the sole authentication readers and writers.
  - [x] Remove the duplicated root login eligibility/role algorithm; preserve protocol-only federation transport tests with an explicit completion mock.
  - [x] Add real JWT custodian tests for token use, signed MFA lineage, ticket import and key disposal.
  - [x] Implement the host token/digest adapter against the approved r6 signer/verifier contracts.
  - [x] Add the r6 per-attempt auth binding/runner with callback-owned audit drain and post-commit mail publication.
  - [x] Construct OAuth refresh/state/consent/JWKS participants on the active app executor; no nested transaction in bound refresh/consent.
  - [x] Stage every OAuth identity handler on the CM bound ports; publish ordinary protocol denials after commit and roll back infrastructure failures.
  - [x] Delete root OAuth session authority and its settings-outbox writer; only the per-attempt CM binding supplies these methods.
  - [x] Add private-context execution of the shipped required/optional authentication middleware, returning copied principals only after commit.
  - [x] Mount the staged middleware before business workspace selection; optional authentication never invokes downstream effects twice or ignores infrastructure failure.
  - [x] Add transaction-bound auth workspace provisioning and an explicit Q-K configuration parser with key-reader disposal tests.
  - [x] Add the production auth runner configuration and private HTTP response staging with sanitized failures.
  - [x] Mount real CM WebAuthn options/authentication and login creation in one completion callback.
  - [x] Delete the replaced app passkey authentication handler.
  - [x] Mount CM email and magic-link completions; consume proof and create login before the same commit; delete old email handler.
  - [x] Bind registration to verified email/invitation context and stage a fresh private HTTP context per attempt.
  - [x] Add mounted registration/approval/login coverage with real attestation/assertion and invitation replay across two prepared ceremonies; assert that account approval does not approve tenant membership. Execution awaits A2.0b.
  - [x] Remove the replaced registration finalizer and its old route factory mount.
  - [x] Remove the replaced app registration account/proof writers.
  - [x] Remove the replaced app registration challenge preparation.
  - [x] Route credential listing, rename and revocation through a fresh CM binding; add the CM session-service facade.
  - [x] Resolve credential-route actors with the unchanged bound OAuth consumer, avoiding a nested session-validation abort; add revoked-session mutation regressions.
  - [x] Delete the replaced app credential handler and its revision-free counter/proof mutations.
  - [x] Replace the app session adapter implementation with the CM session-service facade.
  - [x] Remove the app refresh signer and rotation algorithm in favor of CM signed refresh completion.
  - [x] Remove the app session creation writer; require verified CM assertion completion for MFA lineage.
  - [x] Remove the app session validation algorithm; middleware and host consumers use CM validation.
  - [x] Remove the obsolete app JWT signer, key instance and token-claim implementation from session-manager.
  - [x] Route root revoke/revoke-all/list calls through the CM signed-session service and its single delivery ledger.
  - [x] Replace remote-file signing authority with a CM subject-fenced signing callback released only after commit.
  - [x] Remove app SQL session writes and duplicate base-row inserts; refresh projects remotely only after CM CAS commits.
  - [ ] /workspaces (absorbs /tenants) over A2.2 stores; delete tenant-membership.ts, membership seam in cluster-mesh-adapter.ts, product tenant/workspace identity routes.
  - [x] Add CM membership-domain adapters with current tenant-admin checks, serialized anti-abuse caps, full decision auditing and CM-authorized OAuth client listing.
  - [x] Point membership acceptance tests at CM and cover forged global roles and current approver suspension; execution awaits the combined UOW.
  - [x] Mount CM membership handlers directly in the shared workspace router, with typed refusals and sanitized infrastructure failures.
  - [x] Delete the replaced `workspaces/product-tenants.ts` identity routes.
  - [x] Remove the replaced app membership request, decision and directory implementations.
  - [x] Delete `services/auth/tenant-membership.ts`, including the caller-role trust seam and duplicate transition rules.
  - [x] Remove the obsolete root deletion factory/UOW and unused pool-based membership counters; fixed V2 coordinators own deletion.
  - [x] Convert the workspace cutover HTTP fixtures to CM stores, retaining cross-tenant/workspace denial and exact decision-replay assertions.
  - [x] Repair the unpinned historical fixture bridges to CM without changing byte-pinned routes or recreating legacy tables (Argon finding 2).
  - [x] Add mounted member response/idempotency regressions and clean both CM/business workspace fixtures (confirmed Argon findings 3/6).
  - [x] Preserve member error bodies and self-action precedence; absent-member deletion stays a no-op without revision changes or notifications.
  - [x] Add `api/tests/api/auth/cm-workspace-members.test.ts` for current-role authorization, isolated role changes, personal workspace restrictions and joined business rollback.
  - [x] Bind workspace member reads and mutations to CM domains in one transaction, with subject/workspace locks, audit, last-admin protection and current actor checks.
  - [x] Mount the CM member handlers in the shared router; publish workspace membership notifications only after the identity commit.
  - [x] Delete the old product member-list, mention-list and add-member handlers.
  - [x] Delete the old product role-change and member-removal handlers and their identity-only imports.
  - [x] Join workspace provisioning and session adoption to CM's combined transaction; preallocate workspace ids and recheck current account/tenant authority before enrollment.
  - [x] Add binding regressions for account/tenant suspension across adopt, detach, end and get, preserving the prior binding on refusal.
  - [x] Bind detach/end/get and their authority reads to one CM transaction; lock write subjects/workspaces and require current active account/tenant plus profile.
  - [x] Remove bootstrap and per-request admin membership upserts; workspace selection requires an existing CM admin membership (Mistral M3).
  - [x] Resolve workspace selection on one CM snapshot and delegate explicit personal-workspace provisioning to the bound CM hook without role elevation (Mistral M4).
  - [x] Join VS Code workspace enrollment, creator membership, business metadata and mapping state in the CM transaction (Mistral M2).
  - [x] Delete the unsafe standalone workspace business-first/member-after deletion path; record the missing CM cleanup contract instead of duplicating identity SQL.
  - [x] Use atomic CM enrollment for imported workspaces and translate current-authority refusals on product/import creation without a 500.
  - [x] Add real CM consent/protocol rollback, revocation, explicit-tenant and suspended-tenant regression tests before removing the old consent authority path.
  - [x] Bind OAuth tenant selection and token-time checks to the CM TidIssuer; use its immutable slug and reject suspended tenants in the current transaction.
  - [x] Commit CM consent authority with OAuth protocol evidence under the subject fence; reject unbound writes, remove the default tenant, and honor CM revocation on reads.
  - [x] Add service-client tenant regressions for absent binding, distinct registry id/slug, suspended tenant and joint protocol/CM rollback.
  - [x] Read fixed S2S bindings exclusively from CM, and validate connector enrollment tenants in the same CM snapshot.
  - [x] Use CM service bindings in the LLM directory's shared snapshot and drain S2S mint audits through the current CM binding instead of a root logger.
  - [x] Provision service protocol credentials and CM tenant bindings atomically; seed replay preserves existing bindings, including suspended tenants.
  - [x] Delete the residual service-client tenant column in the single cutover migration after import/checkpoint; update tenant-data regressions to require explicit CM bindings.
  - [x] Delete the obsolete app WebAuthn registration/authentication/challenge services and their superseded tests after adding real CM ceremony coverage.
  - [x] Replace the obsolete sweep-expiry expectation with r6's current-read guest role while preserving pending status and its deadline.
  - [x] Delete the app approval-expiry writer; schedule only the CM revocation worker, and run proof retention through the CM UOW.
  - [x] Preserve committed membership success when post-commit realtime hints fail, with HTTP regression coverage for both notification and mutation failures.
  - [x] Resolve tenants in one CM snapshot and translate only actual boundary refusals; private retry and infrastructure failures propagate unchanged.
  - [ ] resolution + tid + admin + F15: delete resolve-tenant.ts, TENANT_RESOLUTION_MODE, OAuth tid legs, identity parts of admin-product-authority.ts; replace request-authority.ts with F15.
  - [x] Evaluate F15 and business workspace visibility on one serializable read transaction.
  - [x] Add explicit verified-HTTP conversation admission and an opaque CM reference on business chats; no identity authority is inferred from a chat id.
  - [x] Admit conversations before chat job publication and resolve turn authority through the CM reference; F15 refusal leaves the complete tool set empty.
  - [x] Load artifact assets outside CM callbacks and pass every tool identifier through the F15 catalog mapping.
  - [x] Fence chat creation with CM subject/workspace locks and atomically revoke conversation authority when deleting its business chat.
  - [ ] Account deletion through the A2.3/A2.0b atomic cascade (V2), self + admin handlers.
  - [x] Add a real V2 deletion failure test with a subject-scoped final-delete trigger, nontransactional reachability probe, exact row snapshots, durable rollback receipt and orphan checks; execution awaits A2.0b.
  - [x] Add fixed V2 self/admin authorizers with current CM prerequisites and a complete business ownership/reference plan; membership alone never authorizes destruction.
  - [x] Declare personal-data deletion and nullable shared-attribution dispositions, with a database inventory guard for unclassified person references.
  - [x] Extract the unchanged persisted job-to-stream mapping for deletion inventory without initializing the queue manager in CM callbacks.
  - [x] Process every authorized workspace's persisted history/stream/job scope and business dependency graph; detach retained chats/traces and refuse restrictive cross-scope references.
  - [x] Bind the real V2 business participant with summed affected-row receipts and subject-scoped job deletion/orphan checks across retained workspaces.
  - [x] Bind remote/catalogue effects and verify absent agent/purpose capability inventory plus scoped r13 bindings/runtimes; any deployed unbound authority blocks deletion.
  - [x] Construct fixed self/admin V2 coordinators over the combined UOW; require explicitly qualified reservation/deletion/diagnostic/read budgets before entry.
  - [x] Mount self deletion without pre-disabling outside V2; preserve operation ids and distinguish rollback, pending delivery and complete HTTP outcomes.
  - [x] Mount admin deletion on its fixed V2 authorizer; remove outside-transaction prerequisite reads and direct remote delivery.
  - [x] Bind account approve/disable/reactivate and self-deactivate to the frozen CM lifecycle, current actor guards, profile metadata and one-ledger revocation in one callback.
  - [x] Add the CM-backed admin identity router and one-snapshot authorized user directory projection, leaving business administration separate.
  - [x] Mount CM-backed administration and delete the replaced user-list/lifecycle/delete handlers from admin-product-authority.
  - [x] Remove obsolete admin identity schemas/imports and mount transactional CM self-deactivation, including revocation in the same commit boundary.
  - [x] Delete the replaced app cascade coordinator and its membership-as-ownership business participant.
  - [x] Delete the obsolete raw settings/tombstone writers and single-workspace deletion helpers with the old account-deletion module.
  - [ ] Rollback checkpoint recorded BEFORE any legacy table deletion; one author per namespace via cutover records.
  - [x] Preserve the pre-deletion checkpoint row and retain account-driven OAuth invalidation after cutover.
  - [x] Rebind client, consent, membership, credential and restore invalidation to CM identity records.
  - [x] Correct PostgreSQL index qualification and the OAuth consent account lock column.
  - [ ] All residual readers of legacy identity tables switched to CM stores (46-file inventory).
  - [x] Replace omitted artifact authorization and login-credential SQL readers with CM identity sources.
- [ ] **Lot 3 — Deletions**
  - [ ] Drop legacy identity tables in migration; delete identity part of api/src/db/schema.ts and the named files; no dual writer, no legacy fallback.
- [ ] **Lot 4 — F11 screens + e2e**
  - [x] Add CM-owned login/registration screens and shared completion/continuation behavior with host-only navigation/session ports.
  - [x] Add the app projection of CM auth screens with host storage/navigation adapters and declare the UI package dependency.
  - [x] Replace root login/registration flow implementations with CM screen projections; remove their duplicated continuation/session/navigation decisions.
  - [x] Add shared CM management screen ports and transport for account administration, membership decisions and workspace members.
  - [x] Relocate the existing account-administration screen into the CM package and project it from settings; portable host-port conversion follows.
  - [x] Replace the moved screen's duplicate row/status/role declarations with its shared CM management view contract.
  - [x] Make the CM admin screen portable through host ports and remove root behavior duplication; pending-delivery presentation follows.
  - [x] Retain deletion operation ids across retries and distinguish completed deletion from pending external revocations in localized admin feedback.
  - [x] Add the CM membership request/decision screen with tenant-scoped lists, explicit independent approvals, author/time display and stale-response exclusion.
  - [x] Add the CM workspace-members screen with current-member management gates, committed-role display and scope-bound mutations/refresh.
  - [x] Share the app's management host ports and localized membership labels; locale changes refresh the projected screen text.
  - [x] Project CM members in workspace settings and mount the membership decision/request page, including the no-workspace recovery path.
  - [x] Delete the replaced app member list/add/role/remove behavior and selection watcher; only the CM screen owns those interactions.
  - [ ] Login, registration, admin, membership decision, members screens; e2e on ENV=e2e-app-a4.
- [ ] **Lot 5 — Tests**
  - [x] Add a real Chromium virtual-authenticator and Maildev registration fixture for F11 qualification, without logging proof material or stubbing identity services.
  - [x] Add F11/gap browser acceptance for independent approvals, members, live-session suspension, revoke-all and a fresh passkey login; execution remains pending the qualified stack.
  - [ ] gap-§1 scenario end to end; registration → approval → login; invitation consumed once; revoke-all; mid-session suspension empties tool set; account deletion with injected failure leaves no orphan and preserves rows; migration tests; F11 e2e.
  - [ ] Rehearse migration on a fresh prod dump (existing rehearsal make target); record receipt.
- [ ] **Lot 6 — Final validation**
  - [x] Add a real none-attestation registration fixture over the same valid public COSE key and verify it with the actual WebAuthn library.
  - [x] Preserve the shipped validation-error DTO, including field details, while discarding rolled-back success fields and cookies.
  - [x] Delete the replaced app WebAuthn service adapter after migrating its remaining MFA test consumer to real CM completion.
  - [x] Replace the obsolete MFA adapter mock with signed assertions through the mounted CM login route; verify UV success and no session for required-UV refusal.
  - [x] Replace malformed credential fixture bytes with real public P-256 COSE keys and add a signed-assertion fixture checked by the actual WebAuthn verifier.
  - [x] Delete the replaced magic-link service, including the separate issuer and mail-failure fallback; CM completion and deferred delivery are the only paths.
  - [x] Delete the obsolete standalone magic-link verifier and its split account/proof mutations; all completion consumers use CM.
  - [x] Delete the replaced app magic-link route; only the CM completion projection remains mounted.
  - [x] Delete the unmounted magic-link route's old issuance adapter before removing the remaining legacy route.
  - [x] Remove the unmounted magic-link route's obsolete device-activation writer as the first atomic deletion of that replaced route.
  - [x] Exercise CM magic-link issuance/consumption in the existing regression suite, fill its expired-link case and preserve the ten-minute lifetime and branded mail.
  - [x] Revalidate manual social-link actors through the unchanged OAuth session consumer over bound CM ports, without nesting a different completion flow.
  - [x] Retain caught adapter failures in the host attempt fence and prohibit further queries before rollback, including private restart signals without a driver error.
  - [x] Delete the old email verification service, including its Math.random code issuer and development proof-logging fallback; CM owns issuance and exchange.
  - [x] Preserve verification-mail branding in post-commit CM delivery and test sanitized observable delivery failure without a code-logging fallback.
  - [x] Delete the standalone email-code exchange writer and exercise the CM completion service from registration test fixtures.
  - [x] Isolate the inherited ticket signing seed for CM import/runtime and delete the unused legacy validation-token verifier.
  - [x] Move OAuth state regression fixtures to CM accounts and independent bound request transactions, retaining consume-once concurrency assertions.
  - [x] Reject unbound and escaped OAuth state participants before any protocol query; join protocol expiry cleanup to a CM write transaction.
  - [x] Resolve client-bound invitation context from the verified OAuth continuation using the existing state key and a fresh per-attempt expiry check.
  - [x] Specify invitation client binding tests with real sealed OAuth continuation signatures, exact expiry, retry expiry, tampering and email mismatch.
  - [x] Restore social start/refusal protocol audit outside the CM completion while keeping transactional success audit in the CM ledger; cover the real route and broker.
  - [x] Recheck verified social assertion expiry with the live attempt clock after blocking mutations; reject malformed deadlines before CM work.
  - [x] Bound replayed HTTP request bodies and publish only error DTOs without provisional cookies or candidate tokens after a confirmed rollback; add publication-boundary tests.
  - [ ] typecheck/lint api+ui; targeted make tests; push often; draft PR base feat/cm-identity-a2-0b.
  - [ ] ONE CI run on the final head (after rebase onto origin/main once A2.0b merges).
  - [ ] Report to .tmp/rv/lot-A4.md; stop; do not merge.


---

<!-- Retained main-train reference (union rebase onto origin/main a1d0a815a): train BRANCH.md follows verbatim, including the BRLOCK-EX1 policy reference. -->

# Feature: A4 train — cluster-mesh gap lots G1-G5

## Objective
Integrate the five approved A4 cluster-mesh gap lots G1 to G5 (PRs #899, #902, #900, #903, #904) onto origin/main in one train PR, with a single version bump and single lock/fixture/manifest regeneration.

## Scope / Guardrails
- Scope limited to the union of the five lot path lists (design `.tmp/cm-identity-agents/a4-cm-gaps-r2.md`, lots G1-G5).
- Wagon branches merged with `git merge --no-ff` in order G1, G2, G3, G4, G5; conflicts resolved as UNION (keep every lot code and test).
- Version and lock conflicts: take either side during merges, then set `@sentropic/cluster-mesh` once to the next free dev version above main and regenerate through make.
- Make-only workflow, no direct Docker commands; one Docker lock per make command (`flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md make ...`), never nested; the sibling train `release/train-2026-11-04` keeps Docker priority.
- Tests on `ENV=test-train-a4` only, ENV always last; `make down-volumes ENV=test-train-a4` at the end, including on failure.
- No `[skip ci]` anywhere; commits via `make commit MSG="..."` only, <=150 lines, selective staging.
- Branch development happens in worktree `tmp/worktrees/train-a4` (branch `release/train-a4-gaps` from `origin/main`).
- In every `make` command, `ENV=<env>` is passed as the last argument.
# Feature: Release train 2026-11-04 (integration lane, wagons D + B + A + C)

## Objective
Integrate the wagon branches into one release branch with `--no-ff` merges in order D, B, A, C, assign package versions once, regenerate the integration-owned files once through make, and open exactly one READY PR with one CI.

## Scope / Guardrails
- Scope limited to the union of wagons D (`fix/mcp-terminal-jsonrpc-response`), B (`feat/share-g2-mcp-tools`), A (`feat/artifacts-files-parity-lot1` @ 238a3ff5d) and C (`feat/reader-consent-persistent` @ d8df0daa1); all four merged, departure called.
- Merge order: D first, then B, then A, then C, each with `git merge --no-ff`; conflicts resolved as UNION.
- The integration lane owns versions, CHANGELOG entries, locks, the APP-P1 pin, cluster-mesh fixtures and the L5 manifest: on conflict take either side, then REGENERATE once at the end through make.
- Versions: `@sentropic/artifacts` 0.2.13, `@sentropic/mcp-platform` 0.4.2 (verified free on the registry through a repo make target, never npm on the host).
- Pre-existing MCP tool definitions stay byte-identical (tools/list snapshot must pass).
- Make-only workflow, no direct Docker commands; Docker under `flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md` taken PER COMMAND (never nested, never a held shell).
- Tests on `ENV=test-train` (always LAST argument), never `ENV=dev`; every lane ends with `make down-volumes ENV=test-train`.
- No `[skip ci]` in any commit; CI budget: one run on the final head; never `gh run rerun`.
- Never merge `main` into this branch; future updates go through `git rebase` only if the conductor orders it.
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/src/identity-contracts/**`
  - `packages/cluster-mesh/src/identity-stores/tenancy-postgres.ts`
  - `packages/cluster-mesh/src/identity-stores/tenancy-sqlite.ts`
  - `packages/cluster-mesh/src/identity/**`
  - `packages/cluster-mesh/src/storage/identity/**`
  - `packages/cluster-mesh/tests/identity/oauth-reads.spec.ts`
  - `packages/cluster-mesh/tests/boundary-resolution.spec.ts`
  - `packages/cluster-mesh/tests/identity/service-tenancy.spec.ts`
  - `packages/cluster-mesh/tests/identity/workspace-deletion.spec.ts`
  - `packages/cluster-mesh/tests/identity/replica-sync.spec.ts`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json` (mechanical lockfile sync of the single train version bump only)
  - `api/package-lock.json` (mechanical `file:` sync of the same bump only, pattern ddbe7b65e)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `tools/memory-mcp-l5/artifacts/**` (BR-TRAIN-EX1)
  - `packages/mcp-platform/**`
  - `packages/mcp-broker/package.json`
  - `packages/artifacts/**`
  - `api/src/services/mcp/registry-dispatch.ts`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/api/registry-dispatch-terminal.test.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `api/tests/api/artifacts-host-publication.test.ts`
  - `api/tests/api/app-artifacts-transport.test.ts`
  - `api/tests/api/artifacts-host-credentials.test.ts`
  - `package-lock.json` (TR01-EX2, version lines only)
  - `api/package-lock.json` (TR01-EX2, `file:` link lines only)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json` (TR01-EX3)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json` (TR01-EX3)
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` (TR01-EX3)
  - `packages/cluster-mesh/tests/integrations/artifacts-surface.spec.ts` (TR01-EX8, SPEC_TOOLS union only)
  - `packages/artifacts/probe/packed-consumer.mjs` (TR01-EX8, EXPECTED_TOOLS union only)
  - `api/src/services/artifacts/host-storage.ts` (TR01-EX8, 0008 asset pin + relations only)
  - `api/src/services/artifacts/reader-consent.ts`, `api/src/services/artifacts/composition.ts`, `api/src/services/artifacts/instance.ts` (TR01-EX8, wagon C binding union)
  - `api/src/routes/namespaces/artifacts.ts`, `api/src/routes/namespaces/resources-module.ts` (TR01-EX8, wagon C routes union)
  - `api/tests/api/artifacts-reader-consent.test.ts` (TR01-EX8, wagon C test)
  - `Makefile` (TR01-EX7, wagon A presigner dep-sync lines only), `scripts/ci/tool-locks.json` (TR01-EX7, append-only presigner entries), `packages/cluster-mesh/tests/storage/cold-workspace.sh` (TR01-EX7, one-line presigner install)
  - `tools/memory-mcp-l5/artifacts/**` (TR01-EX5, P1 manifest regen)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/cluster-mesh/src/**` except the identity-contracts, identity and storage/identity paths above
  - `api/src/**`
  - `api/tests/**`
  - `ui/**`, `e2e/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` (only if the fixture re-pin flow requires it)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `api/**`, `ui/**`, `e2e/**`, `apps/**`, `deploy/**` except the Allowed files above
  - `packages/**` other than `packages/artifacts/**`, `packages/mcp-platform/**` and the TR01-EX3 files above
- **Exception process**:
  - Declare exception ID `TRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- BR-TRAIN-EX1 (scope exception, `tools/memory-mcp-l5/artifacts/**`): the root lock carries the new train cluster-mesh dev version after `make lock-root`, so the committed P1 manifest no longer matches the live lock fingerprint; regenerate through `make memory-l5-pack STAGE=pre-candidate ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json` (never hand-editing digests), previous manifest retained in `artifacts/history/`. Rollback: restore the retained history manifest/sidecar and delete the new snapshot. Precedent: G1 lane (969adf3a), main 3dd7d8012.
- BR-TRAIN-EX2 (packaging fixture re-pin): `tests/packaging/prepare-artifacts.spec.ts` requires the `selected` fixture to pin the workspace candidate version exactly; re-pin `fixtures/selected/package.json` + `package-lock.json` through `make pack-candidate-siblings` + `refresh-lazy-package-lock`. Rollback: revert the fixture files to the main pin. Precedent: G4 BR-G4-EX2, G5 BR-G5-EX2.
- G1 review (`.h2a/reviews/pr899-large4_r1.md`): VERDICT APPROVE.
- G2 review (`.h2a/reviews/pr902-large4_r1.md`): VERDICT APPROVE (parallel dev.7 collision expected, conductor assigns versions in merge order).
- G3 review (`.h2a/reviews/pr900-large4_r1.md`): VERDICT CHANGES; only findings are the version collision and its lockfile desync — both resolved by this train (single dev.9 bump + root lock regen, no per-wagon bump).
- G4 review (`.h2a/reviews/pr903-large4_r1.md`): VERDICT APPROVE.
- G5 review (`.h2a/reviews/pr904-large4_r1.md`): VERDICT APPROVE.
- TR01-EX2 (lock pins): the 0.2.13 + 0.4.2 union changes workspace version lines, so root `package-lock.json` entries are refreshed through `make lock-root` (version lines only) and the two `../packages/*` version lines in `api/package-lock.json` are synced (same targeted one-line syncs as #878 BRP0B-EX1). No dependency graph change. Rollback: revert the lock lines with the version fix.
- TR01-EX3 (cluster-mesh packaging fixture re-pin): the `selected` fixture must pin both workspace candidate versions exactly (artifacts 0.2.13, mcp-platform 0.4.2). Re-pin through `make -f packages/cluster-mesh/packaging.mk refresh-lazy-package-lock` with the packed sibling receipts, never hand-editing integrities. Rollback: revert the fixture files to the origin/main pins.
- TR01-EX5 (memory-l5 P1 manifest): every lock change requires regenerating the P1 manifest through `make memory-l5-pack STAGE=pre-candidate ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json`; previous manifest+sidecar retained in `artifacts/history/`. Rollback: restore the retained history manifest/sidecar and delete the new snapshot.
- TR01-EX6 (APP-P1 pin): the shipped profile digest and manifest digest in `api/src/services/mcp/cluster-registry.ts` are recomputed through make after the union; pre-existing tool selection unchanged. Rollback: restore origin/main digests.
- TR01-EX7 (wagon A mechanical sync, inherited union): `Makefile` presigner dep-sync lines on the artifacts lanes only, append-only presigner entries in `scripts/ci/tool-locks.json`, one-line presigner install in `packages/cluster-mesh/tests/storage/cold-workspace.sh`; no other lane touched. Rollback: revert those hunks to the D+B state.
- TR01-EX8 (wagons A+C tool-union wiring): `EXPECTED_TOOLS` (probe) and `SPEC_TOOLS` (mesh surface spec) extended to the 21-name union in capability order; 0008 migration asset pin + `reader_consents`/`reader_consent_events` relations in `host-storage.ts`; wagon C api binding/routes/test union. Pre-existing tool selection and definitions unchanged. Rollback: restore the D+B pins and drop the C api files.
- Wagon watch: CLOSED. A (`feat/artifacts-files-parity-lot1` @ 238a3ff5d) merged with `--no-ff` (union), then C (`feat/reader-consent-persistent` @ d8df0daa1) merged with `--no-ff` (union). Both wagon tips are ancestors of HEAD. Departure called: no more wagons join this train.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - G2 precedent: PostgreSQL spec timeouts under shared-host load, same head + same command rerun 16/16 — proven transient, no timeout change.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single integration branch, merges of five reviewed heads, one final test cycle)
- Rationale: five approved wagon heads merged in order with union resolution; one version bump; one test cycle.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI surface change; cluster-mesh package lanes only on `ENV=test-train-a4`.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and worktree**
  - [x] Read `rules/MASTER.md`, `.tmp/packets/COMMON-RULES.md`, design `.tmp/cm-identity-agents/a4-cm-gaps-r2.md` §5.
  - [x] Create worktree `tmp/worktrees/train-a4` on branch `release/train-a4-gaps` from `origin/main` (3dd7d8012).
  - [x] Write this `BRANCH.md` from `plan/BRANCH_TEMPLATE.md` with BRLOCK-EX1 review_by line retained.
  - [x] Environment mapping: `ENV=test-train-a4` for every test stack, never root dev; sibling train `release/train-2026-11-04` keeps Docker priority, lock taken per make command only.
  - [x] Confirm command style: `flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md make ... ENV=test-train-a4` with `ENV` last.
- [x] **Lot 1 — Merge G1-G5 in order**
  - [x] `git merge --no-ff origin/feat/cm-a4-gaps-g1-oauth-reads` (G1, #899).
  - [x] `git merge --no-ff origin/feat/cm-a4-gaps-g2-boundary` (G2, #902); union `composition-descriptors.ts` + `index.ts`.
  - [x] `git merge --no-ff origin/feat/cm-a4-gaps-g3-service-tenancy` (G3, #900); union `composition-descriptors.ts` + `index.ts` + `custody-auth.ts`.
  - [x] `git merge --no-ff origin/feat/cm-a4-gaps-g4-workspace-deletion` (G4, #903); union `composition-descriptors.ts` + `index.ts` + `custody-errors.ts`.
  - [x] `git merge --no-ff origin/feat/cm-a4-gaps-g5-replica-sync` (G5, #904); union `composition-descriptors.ts` + `index.ts` + `custody-errors.ts` + storage index.
  - [x] Version/lock conflicts: take either side during merges, regenerate once in Lot 2.
- [x] **Lot 2 — Single version bump and regeneration**
  - [x] Set `packages/cluster-mesh/package.json` to the next free dev version above main (`0.26.0-dev.9` unless another cluster-mesh bump merged first).
  - [x] Regenerate root lock (`make lock-root`), `api/package-lock.json` file sync, packaging fixtures, L5 P1 manifest — all through make, once.
  - [x] `make scope-check` before every commit; atomic `make commit` commits.
- [x] **Lot 3 — Test gates on ENV=test-train-a4**
  - [x] `make test-cluster-mesh SCOPE=tests/identity/oauth-reads.spec.ts ENV=test-train-a4` (G1): 5/5 sqlite.
  - [x] `make test-cluster-mesh SCOPE=tests/boundary-resolution.spec.ts ENV=test-train-a4` (G2): 12 passed + 4 skipped sqlite; 16/16 postgres (one 5s-timeout run rerun green, proven transient).
  - [x] `make test-cluster-mesh SCOPE=tests/identity/service-tenancy.spec.ts ENV=test-train-a4` (G3 sqlite): 19/19 after pre-G1 simulation + positive union test; postgres via identity campaign.
  - [x] `make test-cluster-mesh SCOPE=tests/identity/workspace-deletion.spec.ts ENV=test-train-a4` (G4): 16/16 after descriptor containment fix.
  - [x] `make test-cluster-mesh SCOPE=tests/identity/replica-sync.spec.ts ENV=test-train-a4` (G5 sqlite): 10/10; postgres via identity campaign.
  - [x] `cluster-mesh-identity-test` both profiles: 28 files / 346 tests green on sqlite AND postgres.
  - [x] `make down-volumes ENV=test-train-a4` at the end, including on failure (pg container removed, exit 0).
- [ ] **Lot 4 — Train PR and wagon closure**
  - [ ] Push `release/train-a4-gaps`, open one READY PR « A4 train: cluster-mesh gap lots G1–G5 ».
  - [ ] Comment on PRs #899, #902, #900, #903, #904 that they are superseded by the train PR, and close them.
- [ ] **Lot 5 — CI watch**
  - [ ] Watch the single pull_request CI; fix real failures at the root; empty-commit retrigger only for AI-flaky shards, max 3.
  - [ ] Report steps, PR number and run ids to `.tmp/rv/train-a4.md`; do NOT merge.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- This lane adds no AI-generation path; no AI flaky tests expected.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single integration branch, single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one integration branch merging ready wagon heads; wagons were built and tested on their own branches.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI surface changes in wagons D + B + A + C (C lot 1a is package + thin api binding, no screen); UAT = package suites + scoped api lanes + CI. No browser UAT for this train.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/train-1104`.
  - Push branch before CI.
  - No root-workspace UAT needed (no app surface changed).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`, `.tmp/release-train/TRAIN-2026-11-05.md` (incl. REVISION section).
  - [x] Create isolated worktree `tmp/worktrees/train-1104` on branch `release/train-2026-11-04` from `origin/main` (HEAD 3dd7d8012); copy root `.env`.
  - [x] Verify wagon heads: D `origin/fix/mcp-terminal-jsonrpc-response` = 4e47903bd; B `origin/feat/share-g2-mcp-tools` = ead444fab; A and C have no remote heads yet (local lanes in progress).
  - [x] Verify neither wagon touches `.track` (union-safe, no reseal needed).
  - [x] Confirm command style: `flock /home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md make … ENV=test-train` with `ENV` last, one lock per make command, never nested.
  - [x] Confirm scope boundaries declared above (TR01-EX2/EX3/EX5/EX6).
  - [x] Environment mapping: `ENV=test-train` for every test lane; no custom ports (disposable compose services per make target).
- [x] **Lot 1 — Merge wagon D (`fix/mcp-terminal-jsonrpc-response` @ 4e47903bd)**
  - [x] `git merge --no-ff origin/fix/mcp-terminal-jsonrpc-response`; resolve conflicts as UNION (`BRANCH.md` keeps this train doc; only BRANCH.md conflicted).
  - [x] Lot gate: `git status --short` shows only wagon-D paths plus owned files.
- [x] **Lot 2 — Merge wagon B (`feat/share-g2-mcp-tools` @ ead444fab)**
  - [x] `git merge --no-ff origin/feat/share-g2-mcp-tools`; resolve conflicts as UNION (BRANCH.md + L5 manifest + sha: ours; locks auto-merged).
  - [x] Lot gate: both wagon tips are ancestors of HEAD (`git merge-base --is-ancestor`).
- [x] **Lot 3 — Versions + regeneration ONCE through make**
  - [x] Registry check through a repo make target (Docker-based `qualify-published-install` probes with a published-version positive control): artifacts 0.2.13 free, mcp-platform 0.4.2 free (controls 0.2.12/0.4.1 confirmed published).
  - [x] Keep `packages/artifacts/package.json` at 0.2.13 and `packages/mcp-platform/package.json` at 0.4.2; CHANGELOG entries list wagons D and B.
  - [x] `make lock-root`, `make lock-api` (+ targeted `file:` syncs) (TR01-EX2): both no-diff, union already correct; `lock-api` needed the test-train api stack (ports 8789/5176/1082, 1080 left to wagon C).
  - [x] Cluster-mesh `selected` fixture re-pin through `packaging.mk refresh-lazy-package-lock` (TR01-EX3): no-diff; sibling receipts recollected at train HEAD (artifacts 0.2.13 sha256 844fdaaa, mcp-platform 0.4.2 sha256 f9b3b3c1, both byte-identical to wagon packs); tarball sha512 == spec == fixture lock.
  - [ ] APP-P1 pin recompute through make (TR01-EX6): verified in Lot 4 api pin tests.
  - [x] `make memory-l5-pack STAGE=pre-candidate …` + `make memory-l5-verify` (TR01-EX5): live f0e00f5d archived to `history/`, new manifest 7514ac8d (2 archives, 44 contracts), verify ok (30 files, 54 edges).
  - [ ] Lot gate: `make scope-check` PASS C2 before any commit.
- [x] **Lot 4 — Final validation (all on `ENV=test-train`, LAST)**
  - [x] Typecheck & lint: `typecheck-mcp-platform` PASS, `typecheck-artifacts` PASS, `lint-artifacts` PASS.
  - [x] Scoped lanes: `test-mcp-platform SCOPE=tests/hono.test.ts` 21 passed; `test-api-unit` (registry-dispatch-terminal + app-artifacts-transport + artifacts-host-credentials) 49 passed; `test-artifacts SCOPE=tests/share-g2-tools.test.ts` 6 passed; `SCOPE=tests/share-g2-errors.test.ts` 6 passed; `SCOPE=tests/tools-list-snapshot.test.ts` 1 passed (pre-existing definitions byte-identical).
  - [x] Pin lane: `test-api-endpoints` (app-mcp-registry + app-mcp-installed + artifacts-host-publication) 44 passed → APP-P1 digests unchanged, TR01-EX6 verified, no re-pin.
  - [x] Full suites: `test-mcp-platform` 363 passed; `test-artifacts` 556 passed (53 files); `test-artifacts-integration` green (exit 0, 14 files); `test-lazy-package` 135 passed (16 files, sibling receipts recollected at train HEAD, byte-identical tarballs).
  - [x] No UI surface, no E2E, no AI-generation path in wagons D/B: full suites + AI shards run in the PR CI.
  - [x] `make down-volumes ENV=test-train` last (stack + volumes removed, no test-train containers left).
- [ ] **Lot 8 — CI run 41809308029 fence gap (union-only, deterministic, not flaky)**
  - [x] New head green on `validate-artifacts` + `validate-cluster-mesh` (union fixes confirmed); `test-api-unit-integration (endpoints, 2)` failed on `root-mount-fence-completeness`: wagon C routes `/resources/artifacts/reader-consents{,/revoke,/revoke-all,/admin-revoke}` registered but missing from `RESOURCE_PATHS` fence + `IMMUTABLE_ARTIFACT_ROUTES` pin (C lane never ran that file; no E502 flake, never a rerun).
  - [x] Fix: extend `RESOURCE_PATHS` (`api/src/routes/namespaces/resources.ts`) and both immutable pins (`root-mount-fence-completeness`, `cluster-mesh-resources` inventory) with the 4 routes in mount order; wildcard `/resources/artifacts/*` fence already covers method wiring.
  - [ ] Validate `root-mount-fence-completeness` + `cluster-mesh-resources` on `ENV=test-train`, commit, push, watch the single new CI run.
- [ ] **Lot 5 — PR + report**
  - [x] Atomic commits via `make commit MSG="…"` (specific `git add` only, BRANCH.md checkboxes updated in the same commits); `make scope-check` PASS C2 before every commit; no AI trailers; no `[skip ci]`.
  - [ ] Push `release/train-2026-11-04` to origin; update body of PR #911 to list wagons A, B, C, D (body = this BRANCH.md); comment PR #910 as superseded by #911 and close it; exactly one CI run on the final head; do NOT merge #911 (conductor merges after review).
  - [ ] Report every step and every CI run id to `.tmp/rv/train-fix.md` (root workspace).
- [x] **Lot 6 — Wagons A + C watch: CLOSED**
  - [x] A (`feat/artifacts-files-parity-lot1` @ 238a3ff5d) merged with `--no-ff` (union conflicts resolved, no markers left); then C (`feat/reader-consent-persistent` @ d8df0daa1) merged with `--no-ff` (union conflicts resolved, no markers left).
  - [x] Departure called by owner (MAX PRIORITY: ONE train PR shipped now); no more wagons join this train.
- [x] **Lot 7 — A+C union fixes + regeneration ONCE + validation (all on `ENV=test-train`, LAST)**
  - [ ] Root causes from CI logs: train `validate-artifacts` probe `tool name mismatch` (B tools vs 17-name EXPECTED_TOOLS) + `validate-cluster-mesh (source installed major)` SPEC_TOOLS 17 vs 19 (+`artifacts_lookup_people`, `artifacts_list_access`); wagon A same probe cause + stale fixture lock (0.2.12 vs 0.2.13) + SPEC_TOOLS 17 vs 18 (+`artifacts_publish_bundle`). No npm E502 flake in any CI log: real mismatches, fixed in the union, never a rerun. Local E502 on the 127.0.0.1 mirror during refresh traced to stale sibling receipts (unpublished 0.2.13 unresolvable); receipts recollected at union HEAD via repo make flow, refresh then green.
  - [x] Union fixes: probe EXPECTED_TOOLS + mesh SPEC_TOOLS extended to the 21-name union (capability order: 17 + 2 B + 1 A + 1 C); probe css bytes made valid UTF-8 (LOT 1 commit validation); train-numbered migration `0008_reader_consent.sql` + host-storage pin/relations; stale wagon-local test assumptions evolved to the union (files-parity 17+4 pin, reader-consent-world duplicate `set_access` op); CHANGELOG 0.2.13 entries for A and C; versions stay 0.2.13 / 0.4.2 (A+C touch neither mcp-platform nor cluster-mesh versions).
  - [x] Regenerated ONCE through make: `make lock-root` no-diff, `api/package-lock.json` verified in sync (`file:` links + presigner entries, no stack change), `refresh-lazy-package-lock` 1-line integrity re-pin + tuple spec sync, APP-P1 digests verified unchanged on the union (pin tests green, no re-pin), `make memory-l5-pack STAGE=pre-candidate …` (7514ac8d archived, new 7443fd03) + `make memory-l5-verify` ok (30 files, 54 edges).
  - [x] Lot gate: typecheck-artifacts + lint-artifacts + typecheck-mcp-platform + typecheck-api green; scoped lanes of all four wagons on `ENV=test-train` (D: registry-dispatch-terminal 16; B: share-g2 6+6, sharing-management 8, mcp-platform 363; A: files-parity 7, uploads 6, http-uploads-templates 15, migration proof in integration 42; C: reader-consent 5+5+4, api reader-consent 3, host-migrations 16; transport 8, credentials 25, pin lane 27, publication 17; full test-artifacts 579, integration 42+42+29, lazy-package 135, mesh surface 21, probe PACKED_*_OK); tools/list snapshot pre-existing definitions unchanged; `make scope-check` PASS C2 before commit.
  - [x] `make down-volumes ENV=test-train` last (stack + volumes removed, no test-train containers left).
