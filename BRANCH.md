# Feature: Shared comments and annotations model/API — lane M candidate branch

## Objective

- [ ] Deliver M1/P1, M2/P2, M3/P4-M and M4/P5 candidate: canonical contracts, portable PG, common HTTP/service/batch/export/correction and unitary prepared receipts, independently usable by Immo.
- [ ] Qualify the exact model candidate in a clean neutral host; Sentropic's complete consumer conversion is M5-S/P4-S on a separate branch and does not gate this candidate or OWNER-D2 delivery.
- [ ] Keep current API CI green through the explicit temporary-export staging rule; remove those exports with all old consumers in P4-S before a breaking main merge.

## Scope / Guardrails

- [x] Branch `feat/comments-annotations-model` in `tmp/worktrees/comments-annotations-model`, created from the exact LAST documentary promotion-series commit `90e7a9fd89c58178aa889d83dee7b1c3099f08ca` (`docs: anchor comments documentary promotion`); pinned main ancestor `dc95f7e4f88048e9671002827537cde4cb8149b7`. Never rebase away or drop this anchor or its documentary ancestry through P4-S.
- [x] P0 closed: CONF3 confirms source SPEC `c6d7a548d25746243b3904a20adea2d1b96360b3042445ba020a8204479ed967` (0 blocking, 0 major, 7 minor); CONF4 confirms the promotion delta (0 blocking, 0 major, 5 minor, P-1–P-5 recorded); promoted SPEC SHA-256 `abf5b628063a93c92335ab660aeb68b23e40bc3c0c32233ce68b87be99a9ad9f`. The SPEC, three aligned plans, evidence extracts, index and convergence receipt all resolve from the anchor commit alone.
- [x] AUTH-M effective (« j'autorise par défaut tout sauf question empêchant d'avancer »): isolated synthetic P1/M1, P2/M2, P4-M/M3, P5/M4 candidate qualification and separately scoped P4-S. Merge, publication, deployment, real-data processing and actual delivery remain owner-submitted under OWNER-D2.
- [x] G2 a+c fixed: comments model, `/hono` and `/pg`; chat-ui Sentropic UI; contracts unchanged; no `@sentropic/annotations` package or private model. Immo UI reuse remains undecided.
- [x] P1 declares the root plus neutral storage-adapter and canonical HTTP public signatures, ports and wire/DTOs, placed with the cluster-mesh module per owner decision 2026-10-11, with M2/M3 implementations marked due. Every actual shared-contract change after freeze gets a new manifest/version, review and host realignment.
- [x] Distinct canonical exports alongside exact old API signatures consumed via `file:../packages/comments` (`api/package.json:75`); `packages/comments/**` selects mandatory API CI within a triggered workflow. No translator, runtime selector, dual writer or legacy reader of canonical storage.
- [x] Staging: `src/canonical-hono.ts` becomes the distinct canonical `/hono` export in M3, preserving old `src/hono.ts` signatures; the final one-model/router state applies after P4-S.
- [x] Release maintainers on `chore/comments-annotations-delivery` alone own the candidate artifact job/workflow; this branch may scope only required neutral verification wiring.
- [x] Registry at entry: `@sentropic/comments` local 0.2.0 = published 0.2.0 (pack receipt `registry: present`, identical sha256 `907d34611a081d9b6f7c44df39c79741ba62941dc394d0841d7079ea6ce1cc9d`); working version `0.3.0` on the reviewed breaking-minor line strictly above it, via manifest/lock through Make. Neither a publication nor M4's reserved candidate identity.
- [x] M4 source is a clean exact model-branch commit with pinned base/parent, lock and completed P1/P2/P4-M evidence; no uncommitted/generated source substitution or mutable latest link.
- [x] U owns new panel/drawing, actual-browser vectors and runtime ingress/message/job/history/provider proof; these do not gate M1–M4. Existing forced UI conversion belongs to P4-S.
- [x] Every fixture is synthetic. Real or sanitized personal data needs first-entry attribution/redaction/scope and data authority even in a test DB; synthetic roles/quorum/retention never become defaults.
- [x] Eradication scope (TREAT2-validated): `prospect_notes` and Immo's old notes system; count-only conversion evidence for legacy rows not carried over; Immo backups/lifecycle outside this scope; Sentropic rehearses its own cutover backup/restore under Q4.
- [x] ENV/ports (branch slot 0, BR90): `ENV=test-comments-model API_PORT=9450 UI_PORT=5650 MAILDEV_UI_PORT=1550`, `ENV` last in every make command; never `ENV=dev`, never `make clean-all`; one local Docker build at a time, make targets sequential.
- [x] Commits: under 150 changed lines, at most 10–15 files, `git add <named files>` then separate `make commit MSG="type: description"`; update this BRANCH.md within each commit; harness branch check before work and `make scope-check` before commits; never stage `.vibe/`, `.h2a/` or `.env`.
- [x] This model branch is not independently main-mergeable; completion produces a candidate and evidence, not an automatic release.

## Branch Scope Boundaries (MANDATORY)

- [x] **Allowed Paths (implementation scope)**:
  - [x] `BRANCH.md`
  - [x] `packages/comments/src/**`
  - [x] `packages/comments/migrations/**`
  - [x] `packages/comments/tests/**`
  - [x] `packages/comments/package.json`
  - [x] `packages/comments/README.md`
  - [x] `packages/comments/CHANGELOG.md`
  - [x] `packages/comments/MIGRATION.md`
  - [x] `packages/comments/surface.json`
  - [x] `package-lock.json`
  - [x] `docs/comments-annotations/contract/**`
  - [x] `docs/comments-annotations/evidence/**`
  - [x] `docs/comments-annotations-delivery.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `.cursor/rules/**`
  - [x] `plan/NN-BRANCH_*.md`
  - [x] `PLAN.md`
  - [x] `spec/**`
  - [x] `.h2a/**`
  - [x] `.track/**`
  - [x] `.vibe/**`
  - [x] `.env`
  - [x] `packages/contracts/**`
  - [x] `packages/chat-ui/**`
  - [x] `packages/chat-server/**`
  - [x] `packages/chat-core/**`
  - [x] `api/**`
  - [x] `ui/**`
  - [x] `e2e/**`
- [x] **Conditional Paths (only after declared concrete exception)**:
  - [x] `.github/workflows/ci.yml` — only an evidenced neutral verification gap; the candidate artifact job belongs exclusively to `chore/comments-annotations-delivery`. Never skip/red-scope API CI or serialize remote runners by default.
  - [x] `scripts/**` — pin only the exact neutral PG/HTTP/pack/install or surface/identity guard path before an edit; this glob is not blanket script authority.
- [x] **Exception process**:
  - [x] Declare `BRxx-EXn` with exact paths, evidence, reason, impact and rollback in `## Feedback Loop` before touching any conditional/forbidden path.
  - [x] If a neutral fixture needs Make/compose, move the exact authorized path from Forbidden to Conditional before C2; never leave contradictory buckets.
  - [x] Broad comments subtrees cover only plan M.A–M.D and this lot inventory. Actual app consumers, tenant binding, Drizzle/control/outbox/fence and UI/chat belong to separate S/U scopes.
  - [x] The documentary anchor and its ancestry stay unchanged through P4-S; this branch never edits the accepted SPEC or frozen inputs.
  - [x] New M1 source/test paths (bounded purpose, declared at Lot 0): `packages/comments/src/{anchors,geometry,revisions,revision-hash,command-store,commands,reviews,lifecycle,submissions}.ts` (canonical model: five anchors, decimal-string geometry, revision chains/hashes, command store port + CAS/idempotency commands, review/contest, tombstone/archive lifecycle, prepared submission manifest) and additive exports in `src/{types,guards,index}.ts`; tests `packages/comments/tests/{annotation-anchors,annotation-revisions,revision-hash,annotation-reviews,annotation-retention,annotation-conformance}.spec.ts`, `packages/comments/tests/conformance/{comments-conformance,in-memory}.ts`, `packages/comments/tests/fixtures/revision-hash-v1.json`.

## Feedback Loop

- [x] P0; responsible: Astra max author / Opus 5.5 max reviewer; closed at the anchor: CONF3 source acceptance and CONF4 promotion-delta confirmation recorded with the durable evidence chain.
- [ ] CI-STAGING; responsible: comments/API maintainers; inventory old exports and new canonical entrypoints; use the non-mergeable main-targeted draft PR for milestone CI and prove legacy app/canonical fixtures pass.
- [ ] EX-RUNNER; responsible: neutral fixture/build maintainer; M1 server vectors run via existing `make test-comments` (Node-only vitest, no browser); declare the bounded neutral PG/HTTP runner exception at M2 entry, browser runner belongs to U.
- [ ] FREEZE; responsible: comments maintainer and SPEC reviewers; complete exact descriptors/enums/limits, eleven kinds/streams, decision proposal digest and corpus before indexed freeze receipt and host acknowledgement. Requires Astra max authoring + Opus 5.5 max review — not produced by BUILD.
- [ ] IDENTITY; responsible: release maintainer; reserve unique candidate prerelease at M4, source commit and integrity, enforce non-reuse at candidate/normal publisher boundaries and qualify exact locked dependency closure.
- [ ] ARCH-D11; responsible: package/architecture maintainers; additive-preferred policy, optional-executor patch recommendation/behavioral CHANGELOG, driver-agnostic root/hono boundaries, strict packed-surface and BREAKING/minor evidence. Use SPEC §3's comments-migration-note-v1 template for `packages/comments/MIGRATION.md`; assess the contracts external-consumer trigger without modifying contracts.
- [ ] HOST-GATES; responsible: each host's data/policy/operations authority; first-entry/Q3/Q4/tenant-cutover and OWNER-D2 exact delivery dossiers.
- [ ] S-HANDOFF; responsible: Sentropic integration/outbox maintainers; separate P4-S scope must cover deployment hold, schema-only startup, guarded later retirement, disabled/missing-state fence, control watermark/poison retry and backup/restore rehearsal.
- [ ] CADENCE; responsible: integration lead; log agent wall intervals, processing/queues, operator gestures and external waits separately; no calendar forecast.
- [x] COMMIT-SIZE; responsible: build agent; recorded deviation (cross-review F-02): commits `f22161a3c`, `13e1997d4`, `2ece1386c`, `d99a33c4c`, `8420b1b9d` exceeded the 150-changed-line rule, and `a87610641` (186 changed lines, recorded 2026-10-12 at M1 closure) also exceeded it; history is kept intact with no rewrite and no force-push; every other commit from `3bdfd4c5b` onward stays under 150 changed lines.
- [x] CHECKBOX-CADENCE; responsible: build agent; recorded deviation (cross-review F-03): Lot 0/Lot 1 checkboxes were checked in one block in `3bdfd4c5b` instead of within each commit; later lots update BRANCH.md checkboxes within the same commit as the work.

## AI Flaky tests

- [x] Model acceptance invokes no provider and uses explicit synthetic policies; no AI-flaky waiver substitutes for deterministic scope/hash/receipt evidence.
- [x] Existing application provider regressions retain their separate policy while API CI runs; never increase timeouts or disable failing assertions.
- [x] Old-app mutable-edit/hard-delete tests remain during staging; canonical tests assert replacement behavior. Remove old tests with the old exports in P4-S after full conversion.

## Orchestration Mode (AI-selected)

- [x] Multi-branch: one accumulating model candidate branch; separate P4-S, U and delivery scopes with their own BRANCH/ENV/ports.
- [x] M1 contract/server vectors precede M2 neutral PG; M2 precedes M3 common HTTP/services; M3 precedes M4 exact candidate/neutral-host qualification.
- [x] P4-S starts from the exact M4 candidate commit; U can start after M1 freeze using doubles and converges with actual services/host for its own final acceptance.
- [x] One integrating writer per shared contract/manifest/lock; isolated disjoint worktrees, rebase only. No partial main merge or automatic publication.

## UAT Management (in orchestration context)

- [ ] V0-M uses installed neutral HTTP/service/PG: exact save/reload, pinned comment/history, G3/G4 and immutable unitary preparation/receipt; no panel/browser/chat ingress/provider.
- [ ] Exercise all five anchors and box/circle geometry through API, including changed resource digest without capture and no latest substitution.
- [x] Existing web/Chrome/VSCode discussion regression responsibility stays with the current application CI and later P4-S; this branch claims no new capture or UI support.
- [ ] Later V0-U owns mounted-host accessible drawing, actual-browser parity and exact receipt through message/job/history/provider fake.
- [x] Keep evidence tied to the clean candidate commit and exact archives; automated environments stay isolated from dev.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Authority, baseline and exact candidate scope**
  - [x] Confirm P0 receipt, all treated document hashes, durable authority links and no open pre-M1 MAJEUR before BUILD.
  - [x] Read MASTER/workflow/testing/subagents rules, accepted SPEC and aligned plans; record the LAST promotion-series commit `90e7a9fd89c58178aa889d83dee7b1c3099f08ca` and verified main ancestor `dc95f7e4f88048e9671002827537cde4cb8149b7`; harness C1 branch check run.
  - [x] CONF3 n-2: anchor and ancestry recorded; no rebase may rewrite or drop them through P4-S; implementation-only rebases must retain the anchor as ancestor.
  - [x] CONF3 n-5.3: SPEC, three plans, readable authority/review/treatment extracts, exact hashes and convergence receipt resolve from the base commit alone.
  - [x] CONF3 n-5: rechecked `file:` dependency (`api/package.json:75`), workflow triggers (push main / PR main / workflow_dispatch) and `packages/comments/**` filters (`ci.yml:208`, `ci.yml:345-349`), old export consumers and package/registry versions; open the non-mergeable main-targeted draft PR and bind milestone CI to head/tested SHAs; confirm the delivery branch's sole artifact-job ownership.
  - [x] CONF3 n-1: registry version inspected via `make pack-comments` (published 0.2.0, receipt `registry: present`); set working version `0.3.0` strictly above it on the reviewed breaking-minor line, manifest/lock via `make lock-root`; require enforce-package-bump on the draft PR; recheck after each permitted rebase.
  - [x] Allocate ENV/API/UI/Maildev ports and local build slot (slot 0, BR90: 9450/5650/1550, ENV=test-comments-model); name exact new source/test paths; M1 needs no new runner (existing `make test-comments`/`typecheck-comments`).
  - [ ] Gate: scope and checks support independent P1/P2/P4-M/P5 evidence, with green existing API CI and separate S/U responsibilities.

- [ ] **Lot 1 — M1 canonical contracts and contract-freeze receipt**
  - [x] Add plan M.A contracts under distinct canonical exports, preserving the old app-facing signatures and unchanged contracts primitives including CheckpointVersion.
  - [x] Define root, /pg and canonical /hono public signatures, ports and wire/DTOs in contract-v1, with later implementations marked due. Root uses a driver-agnostic transaction handle; no Drizzle/pg type is reachable from root or /hono.
  - [x] Define every SPEC §4.4 record kind/stream; distinguish mutable aggregate/tombstone projections, lifecycle events, operation audits and host-declared conversion reports.
  - [x] Keep annotation primary identity immutable across revisions; close structural triggers, revision pins, observed/conversion/unknown source indicators, provenance/source time, CommonMark/mentions/profiles/segments and capacity descriptor.
  - [x] Preserve exact decimal-string millionth geometry, endpoint boxes, complete shorter-dimension circles in non-square frames, box-collapse denial and crop/frame changes, integer registration time, code-point offsets and no implicit normalization.
  - [x] Separate pure hash vectors from command/host conformance: IDs cannot reveal shadow/alias or synthetic/real membership. Host resolver tests belong to P4-S/P6.
  - [x] Restore all SPEC §4.4 corpus/behavior cases: plain discussions, different annotation-revision pins, unavailable targets, changed selection/capture, denied/unconfigured authority, unchanged/conflicting replay and linked corrections.
  - [x] Implement CAS/idempotency/default denial, all-target access, exact-hash G3/history, archive/tombstone semantics and G4 base/proposed-content binding without circular output hashes. Audit human decision, optional agent proposal and executor/service/run separately; default scope/admin flags never replace authority.
  - [x] Tests: existing domain-schema, in-memory-crud, tenant-scoping, threading, thread-cascade, thread-summary, wire-events and hono suites stay green; new annotation-anchors/revisions/reviews/retention/conformance suites, revision-hash suite and fixtures/revision-hash-v1.json; conformance/comments-conformance.ts and conformance/in-memory.ts. Scoped runs: `make test-comments API_PORT=9450 UI_PORT=5650 MAILDEV_UI_PORT=1550 ENV=test-comments-model`, `make typecheck-comments ... ENV=test-comments-model`.
  - [x] Gate: server corpus plus browser-safe root, descriptor completeness and cross-review; no browser executor here — closed by owner instruction 2026-10-12 with the descriptor/capacity reserves carried to M2 (see the freeze receipt).
  - [x] Produce docs/comments-annotations/contract/contract-v1.json with exact artifacts/source/evidence hashes and declared M2/M3 exports; closed by owner instruction 2026-10-12 — contract frozen at `7b8e5daf0` without the Astra max/Opus 5.5 max review, open reserves carried to M2 via the change protocol; durable indexing of the freeze receipt and host acknowledgement remain due. OWNER-D1 synthetic preparation can then begin.

- [ ] **Lot 2 — M2 portable PG, attached history and lifecycle**
  - [ ] Add plan M.B /pg schema/store/transactions/migrations/change-log/cursors/dispatcher/purge modules and immutable assets; inject connection/clock/IDs, no API imports or autonomous migrator.
  - [ ] Neutral host bootstraps the extension table through its own schema history; record bootstrap/migration/asset/predecessor/checksum and conversion completion transactionally.
  - [ ] Prove scheduling-lock then conversion-lock then deterministic scope-lock order, crash resume, actual packaged/applied byte comparisons and non-skipped upgrades.
  - [ ] Commit model/audit/heads/idempotency/receipts/log atomically; persist canonical bytes and verify PG reload, concurrent allocation, expiry/resync and retry deduplication.
  - [ ] Implement aggregate conversion report: opaque frozen inventory, admissible-manifest digest, host completeness declaration, disjoint source-unit equation; no excluded-row details in manifests, receipts, logs or exports produced with comments tooling, or fabricated completeness.
  - [ ] Implement irreversible tombstones and separate archive, durable purge intent/receipt, revocation/holds/shared-blob handling with synthetic policies; recovery cannot resurrect tombstones.
  - [ ] Tests: pg-store.spec.ts, pg-migrations.spec.ts, pg-events.spec.ts, pg-retention.spec.ts, pg-mapping.spec.ts, fixtures/pg/** and shared conformance.
  - [ ] Gate: actual neutral PG/runner bootstrap/upgrade/rollback/restore and security cross-review; Sentropic tenant/public/control/poison binding remains P4-S.

- [ ] **Lot 3 — M3 common HTTP/services and unitary preparation**
  - [ ] Create src/canonical-hono.ts and its distinct canonical /hono export, preserving old src/hono.ts signatures during staging; evolve the shared command layer; reserve collection routes and inject authorization/resource/capture/decision ports.
  - [ ] Implement coherent importBatch/receipt recovery/exportBatch, changed-input conflict, linked correction/source evolution, copy/move and no inherited validation authority.
  - [ ] Pin complete target/version/comment/structural/capture selection in an immutable unitary manifest with recoverable receipt; preparation invokes no AI.
  - [ ] G4 rechecks authority, base/proposal binding, expiry/revocation and CAS; exact read/export and every page recheck scope/permissions.
  - [ ] Tests: retain hono.spec.ts as old-app regression; add canonical-hono.spec.ts, batch-import.spec.ts, batch-export.spec.ts, annotation-submissions.spec.ts via real neutral HTTP/service/PG; partial atomic groups, commit-before-response, correction, denial and revocation.
  - [ ] Gate: reviewed common model/API behavior and all five anchors, including data-only changed digest; no chat-server/controller/message/job/history/provider dependency.

- [ ] **Lot 4 — M4 exact candidate and independent V0-M**
  - [ ] Freeze clean model-branch source/base/parent/lock; pack root/hono/pg with SQL/manifest assets and full dependency closure, without source mounts or workspace symlinks.
  - [ ] CONF3 n-7, delivery maintainer before P5/M4: qualify the actual delivery-branch workflow trigger without a main merge and record workflow/run/source identity.
  - [ ] Reserve a unique prerelease on the reviewed breaking-minor line; include temporary-export inventory and canonical receiver reachability proof. Reject any same-version/different-integrity build/publication.
  - [ ] Apply ARCH-D11=B with additive-preferred and ARCH-12: CHANGELOG BREAKING entry, packages/comments/MIGRATION.md using SPEC §3's comments-migration-note-v1 template, full packed export/wire surface comparison and reviewed bump class.
  - [ ] Audit root/hono/pg reachability, Hono/Zod and injected driver; enumerate every contracts resolver including comments/chat-core/events and installed chat-ui with exact resolution/integrity.
  - [ ] Record contracts external-consumer trigger assessment under separate architecture authority; leave its source/version unchanged.
  - [ ] Tests: exports.spec.ts, consumer-install.spec.ts, neutral-host-acceptance.spec.ts and fixtures/neutral-host/**.
  - [ ] Gate: V0-M closes without Sentropic conversion or U; all current API CI checks remain green on the same commit. Record archives/manifest/lock and qualification receipts; no real delivery occurs automatically.

- [ ] **Lot 5 — Delivery guide and separate integration handoffs**
  - [ ] Document exact assets, extension bootstrap/history/lock order, independent install, candidate identity guard, available retrieval path, durable receiver copy, rebuild/restore and withdrawal.
  - [ ] Prepare OWNER-D2 dossier for each actual package. Default implementation authority is not handoff approval.
  - [ ] Hand P4-S its exact candidate commit and full consumer list; require distinct-version legacy removal, authority-bound tenant, text-cast source time, public/control binding, poison retry, deployment hold and schema-only startup then post-reconciliation retirement.
  - [ ] Restore Sentropic backup/restore rehearsal under Q4; retain conversion-report counts for legacy rows not carried over.
  - [ ] CONF3 n-6, respective host integration maintainers before P4-S/P6: prove that the Sentropic P4-S rehearsal gates only Sentropic's cutover.
  - [ ] Hand U browser execution and typed runtime/host acceptance; no new receiving-host UI decision is presumed.
  - [ ] Record host first-entry attribution/redaction/scope, HOST-D3 implementation, Q3 activation/Q4 lifecycle, tenant-cutover and delivery/operation evidence at their actual gates.
  - [ ] Gate: technical obligations have bounded responsible scopes; only genuinely uncovered owner choices receive concrete dossiers stating what the answer settles.

- [ ] **Lot 6 — Final candidate verification and review**
  - [ ] Run inspected Make model/PG/HTTP/pack/neutral checks plus existing API CI and relevant quality gates on the exact candidate; no UI/browser/chat-provider test is recast as M acceptance.
  - [ ] Recheck branch/scope, every hunk, temporary exports, surface/version/migration notes, integrity/locks and documented durable evidence; rerun only affected checks after changes.
  - [ ] BUILD cross-review by the other of Vibe GLM 5.3/Gemini 3.8 high; SPEC/plan/freeze deltas get Astra max/Opus 5.5 max convergence on resulting bytes.
  - [ ] Sequence local builds; use exact ports and ENV last, clean only assigned environments. Never test on dev or use clean-all.
  - [ ] Future PR text uses actual BRANCH.md; record candidate readiness with P4-S/main and actual delivery gates still separate. Do not run the generic branch-close merge sequence on this candidate branch.
