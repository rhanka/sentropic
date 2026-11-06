# train 2026-11-06: artifacts 0.2.17, CI contracts, A4 follow-ups and preprod procedure

## Objective
- [ ] Integrate five approved wagons on current origin/main, preserve artifacts 0.2.17 and the qualified locks/pins, keep preprod on its recovery release, and qualify one READY PR; do not merge.
- [ ] Supersedes [#923](https://github.com/rhanka/sentropic/pull/923), [#921](https://github.com/rhanka/sentropic/pull/921), [#924](https://github.com/rhanka/sentropic/pull/924); the conductor closes them after this train merges.
- [ ] Extension 06/11: integrate approved [#929](https://github.com/rhanka/sentropic/pull/929) and `origin/feat/preprod-a4-procedure` (1a5a9ef98 or later), retain the recovery images in preprod until owner-authorized A4 execution, and qualify the extended train without merging.

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
  - `e2e/tests/03-dashboard.spec.ts`
  - `e2e/tests/08-chat-checkpoint-restore.spec.ts`
  - `packages/auth-ui/tests/oauth-consent-rendering.test.ts`
  - `e2e/Dockerfile`
  - `e2e/tests/07-matrix.spec.ts`
  - `e2e/tests/01-app.spec.ts`
  - `api/tests/api/auth/cm-auth-request-concurrency.test.ts`
  - `api/src/services/identity/cm-auth-binding.ts`
  - `api/src/services/identity/cm-transaction.ts`
  - `packages/cluster-mesh/tests/packaging/prepare.sh`
  - `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts`
  - `packages/chat-core/src/runtime/comments/state.ts`
  - `packages/chat-core/tests/runtime/comments-module.spec.ts`
  - `packages/chat-core/tests/runtime/chat-core-host.spec.ts`
  - `packages/chat-core/package.json`
  - `ui/package-lock.json`
  - `api/src/middleware/auth.ts`
  - `api/src/routes/auth/oauth.ts`
  - `api/src/routes/namespaces/admin-identity.ts`
