# Feature: Live STT L8a gateway speech policy and usage

## Objective
- [ ] Bind bounded speech admission, usage and settlement to the gateway ledger owner.
- [ ] L8 acceptance is conditional: this PR delivers L8a policy/contracts only, not M1-ready cloud activation.

## Scope / Guardrails
- [x] Base origin/feat/live-stt-l2; branch feat/live-stt-l8; worktree tmp/worktrees/stt-l8.
- [x] Spec: .tmp/live-stt/spec-plan.md L8, sections 7/11.2; aggregate USD 5 per UTC day / USD 20 campaign.
- [x] Make-only; ENV=test-stt-l8 last; no containers before 2026-10-27 21:00 UTC; shared flock thereafter.
- [x] Specific-file staging; make commit; under 150 changed lines per commit; no attribution trailers.
- [x] No inference, provider credentials, ledger replacement, native dependencies, publication or merge.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-gateway/src/speech/**`
  - `packages/llm-gateway/tests/speech-*.test.ts`
  - `packages/llm-gateway/tests/fixtures/speech-*.ts`
  - `packages/llm-gateway/package.json`
  - `packages/llm-gateway/README.md`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/src/modules/catalog.ts`
  - `packages/cluster-mesh/tests/fixtures/train.ts`
  - `packages/cluster-mesh/tests/modules/registry.spec.ts`
  - `packages/cluster-mesh/tests/modules/topology-ranges.spec.ts`
  - `packages/cluster-mesh/tests/packaging/optional-install.spec.ts`
  - `packages/cluster-mesh/tests/packaging/skew-invariants.ts`
  - `packages/cluster-mesh/tests/packaging/skew-invariants.spec.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `package-lock.json`
  - `.tmp/live-stt/l8/**`
  - `.github/workflows/ci.yml`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `api/tests/unit/gateway-package-version.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/src/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `packages/llm-gateway/src/index.ts`
  - `package-lock.json`
- **Exception process**:
  - [x] Declare BRL8-EXn with reason, impact and rollback before sensitive changes.

## Feedback Loop
- [x] Integration regression (CI 40621929792): official lock refresh also advanced the unrelated artifacts baseline to 0.2.4. Restore the exact published 0.1.4 entry from main, preserving the L8 gateway archive and cluster/mesh tuple; `artifacts-tuple.spec.ts` explicitly requires that baseline.
- [x] Integration evidence: gateway 0.22.0 BLOCK archive SHA-256 `cbf4ef6c51536ed0b26bb2a9f29901c927ef1a986d1d8039e7c44d8394fdb54b`; official `refresh-lazy-package-lock` passes with the verified sibling and current mesh 0.30.0; full gateway suite passes 1370 tests / 78 files with `ENV=test-integrator-stt-l8` under the shared Docker lock.
- [x] Integration: retain main's llm-mesh 0.30 support with the L8 speech floor 0.28 and gateway 0.22.0; use cluster-mesh 0.23.3 above published 0.23.2. Regenerate the selected release lock through the official verified-sibling qualification target; remove the obsolete L2 PR-base filter now that PR798 targets main.
- [x] BRL8-EX7: owner authorizes updating only the API gateway release-tuple test from 0.21.3 to feature version 0.22.0. Run 40511994178 imports 0.22.0 and fails the old equality assertion; unrelated id errors are not its failure. Run the targeted test before the unchanged full API unit suite in GitHub CI; no local Docker before 21:00 UTC. Rollback restores the expectation and removes the targeted CI step with the gateway bump.
- [x] BRL8-EX6: run 40505571158 proves the runtime gateway range and frozen selected tuple still reject gateway 0.22.0. Align only catalog/train ranges, affected test expectations and fixture package/lock; use the verified CI gateway archive's SHA-512. Cluster 0.23.1 supplies the required source bugfix bump. Rollback restores the old ranges/tuple with gateway 0.21.3.
- [x] Frozen gateway 0.22.0 lock integrity comes from run 40507121290, llm-gateway-candidate artifact 12735344167; archive SHA-256 30529da3c0230df3787c30b108b6e7d9f2ba10479ecebd5af0b31b7f02588dc8 matches the prior successful BLOCK packs.
- [x] Run 40509273838 passes gateway (1370 tests, including 27 speech), API/UI typecheck/lint and both BLOCK packs; align the two remaining installed-gateway version assertions via TRAIN_LLM_GATEWAY_VERSION=0.22.0.
- [x] BRL8-EX5: retain the verified gateway pack as a seven-day CI artifact for the required frozen Cluster Mesh release-lock refresh while local Docker is reserved; no publication, credential, permission or validation change. Rollback removes the artifact upload and pack destination.
- [x] BRL8-EX4: update the real gateway dependency-floor assertion in scripts/ci/publishable-ci-wiring.test.mjs from 0.27.0 to required speech floor 0.28.0 (run 40504853431); impact is one CI regression expectation, no gate bypass. Rollback restores the assertion with the old dependency range.
- [x] R1 P1/P2-1: build incremental totals through a mutable dimension map; require llm-mesh >=0.28.0 for speech contracts.
- [x] R1 manifests: registry latest gateway 0.21.3 / cluster-mesh 0.22.4 on 2026-10-27; gateway feature 0.22.0 and cluster peer-range patch 0.23.1 remain unpublished BLOCK candidates. Mirror versions/ranges in package-lock.json; retain full pack gates.
- [ ] G-LEDGER (open, 2026-10-27): L8b durable owner-adapter sub-lot, gateway/ledger owner + Sol; outside this PR's api/** scope. Bind SpeechLedgerPort to control.budgets/budget_holds/cost_ledger, allocator receipts and leases; qualify real DB restart, replica concurrency, UTC rollover, crash/replay and unavailable-store refusal before L8 acceptance or cloud activation.
- [x] R1 P2-2: expose reconcileSpeech on speech/settlement for L7: operation/attempt rows join holds, allocator receipts and usage entries; report duplicate, uncounted and orphan evidence without a new store.
- [x] R1 reconciliation also detects the same scoped native turn counted under different submit keys/epochs; tenant/session boundaries remain isolated.
- [x] Docker reservation takes precedence over the container-backed scope target; temporary host Make adapter invokes the same installed harness C2 check before every commit.
- [x] Registry latest is 0.21.3 (2026-10-27); feature version will be 0.22.0, without publication.
- [x] BRL8-EX1: gateway 0.22.0 requires widening cluster-mesh's optional gateway peer upper bound from 0.22 to 0.23 and mirroring workspace metadata in package-lock.json. Initial manifest compatibility is completed by BRL8-EX6's runtime range and frozen tuple; rollback restores the previous version/range fields.
- [x] BRL8-EX2: permit .tmp/live-stt/l8 review/validation receipts only; no raw media, credentials or accounting store.
- [x] BRL8-EX3: CI ignores pull requests targeting feat/live-stt-l2. Add only that base to the existing pull_request branch filter so PR798 runs standard gates; no job, secret, permission or publication change. Rollback removes the one branch entry.
- [ ] G-REVIEW: author-complementary peer selection remains pending; .tmp/live-stt/l8/review.md records exact target, requested author tuple and selection failure. No reviewer allocation inferred; no consensus claimed.
- [x] G-LEDGER handoff delivered through signed h2a to live s-conductor (env:send:a2aaa010-2d5d-444b-9a7f-1de14fb5d355); gateway/ledger named-session discovery returned no matches.

## AI Flaky tests
- [x] Deterministic fixtures only; no provider calls or waiver.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, sequential authoring; shared gateway/ledger owner files remain untouched.
- [ ] Multi-branch not required.

## UAT Management (in orchestration context)
- [x] Library contract fixtures only; device/provider qualification belongs to L9/L13/L7.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read Docker lock, project rules, L8 row, M1 receipts and G-LEDGER/G-CLOUD/G-QUOTA.
  - [x] Fetch L2 head 3b793cb89c4a0427152907f986f9415b9c348122 and pass mechanical harness branch check.
  - [x] Inspect existing CostContext, pool/budget admission and durable host ledger; no new accounting store.
  - [x] Reserve ENV=test-stt-l8; package fixtures need no listening ports (reserved API/UI/mail: 9040/5240/1140).
- [ ] **Lot 1 — Typed usage and pricing**
  - [x] src/speech/usage.ts: duration/token/character dimensions, revision normalization and pinned USD pricing.
  - [x] tests/speech-metering.test.ts: cumulative/incremental updates, duplicate/conflicting revisions, absent dimensions and invalid prices.
- [ ] **Lot 2 — Admission binding**
  - [x] Pin the campaign across awaits and require connections to end before UTC rollover; bind the authoritative backend operation reference.
  - [x] Add regression fixtures for UTC-boundary refusal, immutable async identity, payload exclusion and missing bound price dimensions.
  - [x] Preserve L2's optional native turn ID before acknowledgement while requiring the admitted allocator/submit/backend operation links.
  - [x] Require the authenticated workspace, matching L2 receipt scope and the M1 identity contract.
  - [x] Define transaction views over existing owner holds/buckets/allocator receipts; no production store supplied.
  - [x] src/speech/admission.ts: trusted campaign identity, UTC daily and campaign caps, authoritative allocator links, bounded holds and fail-closed host port.
  - [x] tests/speech-admission.test.ts: daily/total refusal, provider switching, concurrent reservations, restart/replay, allocator identity and ledger outage.
- [ ] **Lot 3 — Settlement binding**
  - [x] Preserve partial overrun evidence and test rollback after both financial entry and budget mutation, before hold closure.
  - [x] src/speech/settlement.ts: one billable operation, conservative missing-usage estimate, signed true-ups, replay and retained uncertainty.
  - [x] tests/speech-settlement.test.ts: missing usage, adjustment idempotence, restart, unavailable sink and no duplicate backend counted unit.
  - [x] tests/fixtures/speech-ledger.ts: deterministic owner transaction fixture; never exported or used as a production ledger.
- [ ] **Lot 4 — Contract review and integration documentation**
  - [x] Document ledger-owner binding, dispatch bounds, limitations and G-LEDGER acceptance in README.md.
  - [x] Export speech subpath and bump package to 0.22.0; shared owner sources change only for BRL8-EX6's bounded compatibility range.
  - [ ] Reconcile independent correctness and accounting/security reviews; no self-certification of durable host acceptance.
- [ ] **L8b — Durable owner adapter (gateway/ledger owner + Sol; dated 2026-10-27; separate lot)**
  - [ ] Supply the real DB SpeechLedgerPort adapter and one trusted cross-provider campaign identity; no production adapter is provided by L8a.
  - [ ] Pass real DB crash/restart, multi-replica reservations, rollover, adjustment dedupe and store-outage tests; attach evidence to G-LEDGER before accepting L8/M1.
  - [ ] Keep L9/L13 fixture-only and L8 acceptance conditional until this gate passes; scheduling/owner acknowledgement remains pending.
- [ ] **Lot 5 — Draft delivery and validation**
  - [x] Prepare .tmp/live-stt/l8/local-gate.sh: 21:00 UTC guard, exact-head/clean-worktree checks, one package run, locked cleanup and persisted exit receipts.
  - [x] Push feat/live-stt-l8; open draft PR798 against feat/live-stt-l2 with this plan as body and post implementation plan.
  - [ ] Monitor exact-head GitHub CI: lint/typecheck/test/build/pack; resolve branch failures.
  - [x] After 21:00 UTC: full `make test-llm-gateway ENV=test-integrator-stt-l8` passes under the shared flock (1370 tests / 78 files).
  - [ ] Cleanup: flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make down ENV=test-stt-l8.
  - [ ] Report draft PR, head, CI and any remaining G-LEDGER owner gate; preserve BRANCH.md, no merge.
