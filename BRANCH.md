# train 2026-11-06: oauth job workdir + CI consumer contracts (BR-83) + artifacts 0.2.17 application mode

## Objective
- [ ] Integrate three wagons on current origin/main, refresh integration artifacts once, qualify one READY PR; do not merge.
- [ ] Supersedes [#923](https://github.com/rhanka/sentropic/pull/923), [#921](https://github.com/rhanka/sentropic/pull/921), [#924](https://github.com/rhanka/sentropic/pull/924); the conductor closes them after this train merges.

## Scope / Guardrails
- [x] Merge order: `origin/fix/oauth-register-job-workdir`, `origin/feat/ci-consumer-contracts`, `origin/feat/artifacts-0.2.17-app-mode`.
- [x] Base `c107f6abd70e47e0aba33ab4afad01f8dafe4534`; branch `train/2026-11-06`; worktree `tmp/worktrees/train-2026-11-06`.
- [x] Preserve wagon histories and the inherited #921 conversation-row readiness fix; resolve conflicts at the train root.
- [x] Make-only; no Python, CI reruns, CI-skip markers or attribution trailers; selective staging and `make commit`.
- [x] Docker via `/home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh`, one slot per command; cleanup with `make down-volumes`.
- [x] ENV=test-train-1106; API_PORT=9470 UI_PORT=5670 MAILDEV_UI_PORT=1570; ENV always last; no root UAT services.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/ci/compatibility-classifier*.mjs`
  - `scripts/ci/consumer-contracts*.mjs`
  - `scripts/ci/consumer-boundaries.json`
  - `scripts/ci/installed-tuple*.mjs`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `scripts/ci/publishable-classification.test.mjs`
  - `api/package.json`
  - `api/tests/contracts/*-candidate.test.ts`
  - `apps/auth-idp/tests/cluster-candidate.test.ts`
  - `apps/llm-gateway/tests/cluster-candidate.test.ts`
  - `packages/artifacts/src/**`
  - `packages/artifacts/tests/**`
  - `packages/artifacts/package.json`
  - `packages/artifacts/CHANGELOG.md`
  - `apps/artifact-content/src/host.ts`
  - `apps/artifact-content/tests/application-mode.test.ts`
  - `api/src/services/artifacts/**`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/src/routes/namespaces/artifacts.ts`
  - `api/src/routes/namespaces/resources.ts`
  - `api/tests/api/artifacts-reader*.test.ts`
  - `api/tests/api/app-mcp-*.test.ts`
  - `api/tests/api/root-mount-fence-completeness.test.ts`
  - `api/tests/api/cluster-mesh-resources.test.ts`
  - `package-lock.json`
  - `api/package-lock.json`
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package*.json`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/drizzle/*.sql`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/ci.yml` under BR83-EX1
  - `Makefile` under BR83-EX2
  - `apps/auth-idp/tsconfig.json` under BR83-EX3
  - `e2e/tests/08-chat-workspace-switch.spec.ts` under BR83-EX4
  - `deploy/k8s/base/36-oauth-register-client-job.yaml` under BR923-EX1
  - `plan/69-BRANCH_feat-ci-consumer-contracts.md` under BRTRAIN-EX1
  - `tools/memory-mcp-l5/artifacts/**` under BRTRAIN-EX2

## Feedback Loop
- [x] TRAIN-R1 — Consolidated review reproduced missing worker-script CSP (four failing MIME vectors); apply the application policy to asset responses, preserve HTML-only inline hashes, SVG/PDF sandbox and unchanged safe mode. Scoped regression gate required before push.
- [x] BR923-EX1 — #923 OAuth registration job workingDir only; reason: npm must run inside its package; impact: job startup; rollback: revert workingDir.
- [x] BR83-EX1 — #921 CI classifier/contracts/tuple dispatch; reason: prove omitted consumers unchanged; impact: CI selection/verdict; rollback: revert wagon workflow edits.
- [x] BR83-EX2 — #921 named Make entry points; reason: reproducible CI tooling gates; impact: tooling recipes; rollback: revert wagon recipes.
- [x] BR83-EX3 — #921 IdP tsconfig test include; reason: candidate-contract static coverage; impact: test inclusion; rollback: restore prior include.
- [x] BR83-EX4 — #921 inherited readiness-only E2E fix: focus row, require tabindex=0 within two seconds before click; reason: documented unregistered-row race; impact: one test; rollback: revert readiness lines. No timeout/retry increases.
- [x] BRTRAIN-EX1 — Retain #921 durable plan updates; reason: wagon traceability; impact: plan only; rollback: restore base plan.
- [x] BRTRAIN-EX2 — Refresh retained L5 P1 manifest/archives after committing integrated lock; reason: lock freshness; impact: generated evidence; rollback: restore prior artifact set with its lock.
- [ ] Track handoff: designated conductor imports this request, wagons, deliverables and acceptance receipts; this concurrent lane never appends `.track/events.jsonl`.

## AI Flaky tests
- [x] Deterministic failures block; provider exceptions require same-head evidence and explicit owner sign-off; none accepted here.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** — Three wagons, one train integration, consolidated final review and one PR CI; conductor owns final merge.

## UAT Management (in orchestration context)
- [ ] Qualify safe/application mode and reader grants on the exact train head using scoped tests and full PR CI; retain SHA and receipts in the report.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**: read common/master/workflow/testing rules, steward evidence and wagon plans; isolated worktree and mechanical branch gate.
- [x] **Lot 1 — Integration**: merge #923, then #921, then #924; keep this single plan and preserve implementation changes.
- [x] **Lot 2 — Artifacts**: check published version below 0.2.17; regenerate root/API/selected locks, selected archive integrity, APP-P1 digest and L5 P1 once through Make.
- [x] **Lot 3 — Scoped gates**: publishable wiring/classification, compatibility, consumer contracts, installed tuple; artifacts CSP/handler/MIME, content-host application mode, reader-grant/registry and selected packaging tuple tests.
- [x] Local receipts: compatibility 18/18, consumer contracts 21/21, installed tuples 10/10, publishable wiring/classification 57/57; `make test-artifacts SCOPE=tests/content-` 75/75.
- [x] Scoped host receipts through `.tmp/train/integration.mk`: application wrapper 4/4; API registry/grant/consent 31/31; selected tuple/preparation 24 passed with three installed-fixture-only tests deferred to full CI.
- [x] Integration receipt: artifacts archive SHA-256 `89c31a33af3a6e30c38900dac3bfa4da606458a5d28276c5a07505f5f3743f70`; APP-P1 `0725ef3044cf06b04eaae5f407cc364e8c3c8ef570b6835b9aa0038fb556f34b`; L5 `e46814a6678a1bc2b9aedff17c64a2eab522689f250b040134f5de96ad7cbb5c`, packed graph 30 files/54 edges PASS.
- [ ] **Lot 4 — Review and CI**: consolidated final-diff review, mechanical scope/branch gates; push review-ready head, open one READY PR, watch attempt 1 and fix evidenced root causes.
- [ ] **Lot 5 — Handoff**: report `.tmp/rv/train-2026-11-06.md`; clean test volumes; leave train unmerged and wagons open for conductor.
