# Feature: artifacts 0.2.18 train — GitHub enrollment, bindings, forge and builds

## Objective
- [ ] Integrate the approved git-artifact wagons after artifacts 0.2.17, release artifacts 0.2.18 with one ordinary train PR, and keep the train open for subsequent wagons.

## Scope / Guardrails
- [x] Branch `train/artifacts-0.2.18`; isolated worktree `tmp/worktrees/train-artifacts-0218`.
- [x] Base is upstream guarded-candidate checkpoint `6bd09d5569828773ac32dbb10d9b156d9f96de40`, carrying artifacts 0.2.17 and chat-core 0.3.2; advanced through mention checkpoint `fd91e7d2a` under BR0218-EX10/EX11.
- [ ] After the dated train merges, rebase onto `origin/main` and recheck registry versions.
- [x] Make only; Docker commands through `/home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh`, one slot per command.
- [x] Dedicated ports `API_PORT=9600 UI_PORT=5800 MAILDEV_UI_PORT=1700 ENV=test-train-art0218`; ENV always last; tear down volumes after tests.
- [x] Wagons push branches and scoped checks; integration owns versions, locks, fixture pins, APP-P1 digest and L5 once per integrated release head.
- [x] One READY train PR to main; ordinary full CI and package-bump enforcement; no CI gate exception; no merge to main by this lane.
- [x] No skip markers, run reruns, Python, attribution trailers, secret output or live enrollment.
- [x] Selective staging and `make commit` only; newly authored commits stay below 150 changed lines; two-parent wagon merges retain existing history and immutable generated L5 snapshots retain exact bytes under BR0218-EX4.
- [x] G0 FROZEN v3 contract SHA-256 `4c405c8f49e9d242d65eebe35a14a45e4826afc0007e9f94a7fe21d7404e21ba` remains binding.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json` (required by `scripts/ci/ci-lockfile-installs.test.mjs`, enforced by the `validate-publishable-manifests` CI job).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/**`
  - `packages/cluster-mesh/src/forge/**`
  - `packages/cluster-mesh/src/index.ts`
  - `packages/cluster-mesh/tests/forge/**`
  - `packages/cluster-mesh/docs/github-app-enrollment.md`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/CHANGELOG.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.track/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package-lock.json` (BR0218-EX1)
  - `api/package-lock.json` (BR0218-EX1)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/**` (BR0218-EX2)
  - `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts` (BR0218-EX2)
  - `api/src/services/mcp/cluster-registry.ts` (BR0218-EX3)
  - `api/tests/api/app-mcp-registry.test.ts` (BR0218-EX3)
  - `api/tests/api/app-mcp-installed.test.ts` (BR0218-EX3)
  - `tools/memory-mcp-l5/artifacts/**` (BR0218-EX4)
  - `e2e/Dockerfile` (BR0218-EX5, BR0218-EX12)
  - `api/src/services/identity/cm-session-facade.ts` (BR0218-EX6)
  - `api/src/services/identity/cm-auth-binding.ts` (BR0218-EX6)
  - `api/src/services/identity/cm-http-principal.ts` (BR0218-EX6)
  - `api/src/services/identity/cm-session-activity.ts` (BR0218-EX6)
  - `api/tests/api/auth/cm-session-read-concurrency.test.ts` (BR0218-EX6)
  - `api/src/services/identity/cm-transaction.ts` (BR0218-EX7)
  - `api/tests/api/auth/cm-auth-request-concurrency.test.ts` (BR0218-EX7)
  - `e2e/tests/03-dashboard.spec.ts` (BR0218-EX7)
  - `e2e/tests/07-matrix.spec.ts` (BR0218-EX7)
  - `e2e/tests/08-chat-checkpoint-restore.spec.ts` (BR0218-EX7)
  - `packages/auth-ui/tests/oauth-consent-rendering.test.ts` (BR0218-EX7)
  - `packages/cluster-mesh/tests/packaging/prepare.sh` (BR0218-EX8)
  - `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts` (BR0218-EX8)
  - `ui/src/routes/organizations/[id]/+page.svelte` (BR0218-EX9)
  - `e2e/tests/01-organizations-detail.spec.ts` (BR0218-EX9)
  - `packages/chat-core/src/runtime/comments/state.ts` (BR0218-EX10)
  - `packages/chat-core/tests/runtime/comments-module.spec.ts` (BR0218-EX10)
  - `packages/chat-core/package.json` (BR0218-EX10)
  - `ui/package-lock.json` (BR0218-EX10)
  - `packages/chat-core/tests/runtime/chat-core-host.spec.ts` (BR0218-EX11)
  - `scripts/ci/publishable-ci-wiring.test.mjs` (BR0218-EX11)
- **Exception process**:
  - [x] Declare reason, impact and rollback before conditional changes; never weaken a CI gate.

## Feedback Loop
