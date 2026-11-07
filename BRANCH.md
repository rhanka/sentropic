# Feature: preserve tested GHCR config identity across Docker image stores

## Objective
- [ ] Fix API/UI publication from main b5d08ccc9; preserve strict config equality and immutable collision refusal, then open one READY PR and exit without CI polling.

## Scope / Guardrails
- [x] Branch `fix/ghcr-publish-digest-r2`; worktree `tmp/worktrees/ghcr-publish-r2`; base origin/main b5d08ccc9.
- [x] Scope is the urgent publication hotfix; inherited train evidence remains available in base b5d08ccc9.
- [x] Environment test-ghcr-publish-r2; API_PORT=9690 UI_PORT=5890 MAILDEV_UI_PORT=1790; fixture tests need no services.
- [x] Make only; Docker commands through `/home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh`, one slot per command.
- [x] One READY hotfix PR to main; ordinary CI, no gate exception and no merge by this lane.
- [x] No skip markers, run reruns, Python, attribution trailers, secret output or live enrollment.
- [x] Selective staging and make commit only; every new commit stays below 150 changed lines.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json` (required by `scripts/ci/ci-lockfile-installs.test.mjs`, enforced by the `validate-publishable-manifests` CI job).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `Makefile` (BRGHCR2-EX1)
  - `scripts/ci/image-receipt.mjs`
  - `scripts/ci/image-receipt.test.mjs`
  - `scripts/ci/publish-image.mjs`
  - `scripts/ci/publish-image.test.mjs`
  - `scripts/ci/resolve-ui-image.mjs`
  - `scripts/ci/resolve-ui-image.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.track/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (not required)
- **Exception process**:
  - [x] Declare reason, impact and rollback before conditional changes; never weaken a CI gate.

## Feedback Loop

- [x] BRGHCR2-EX1: owner authorizes urgent publication repair; change only CI API publication prerequisites and scoped tests in Makefile. Impact: the receipt-aware publisher checks collisions before push. Rollback restores these lines.
- [x] GHCR2 diagnosis: run 42347515474 imageId equals the anonymous GHCR manifest digest (API 54fd317d..., UI 6fc8f633...), whereas config digests are API 2c42cf19... and UI 0152249a.... API tag was absent and pushed; both failures precede main promotion.
- [ ] Conductor imports this owner request, hotfix lot and final .tmp/rv/ghcr-publish-r2.md into Track as designated single writer; this lane updates the mergeable source only.

## AI Flaky tests
- [x] No flaky allowance, timeout or retry change.

## Orchestration Mode (AI-selected)
- [x] Single hotfix branch; two independent Astra xhigh code reviews under the current owner model rule.

## UAT Management (in orchestration context)
- [x] No product surface changes; local Docker fixture tests exercise publication and refusal behavior.

## Plan / Todo (lot-based)
- [ ] **Hotfix — bind publication to tested config bytes**
  - [x] Read common rules, MASTER, workflow and testing; branch C1 passes on the requested branch.
  - [x] Record configDigest from the tested archive separately from local imageId; preserve source, archive and loaded-image guards.
  - [x] Reject existing different configs before push; preserve canonical UI reuse across Docker stores.
  - [x] Scoped tests: image-receipt.test.mjs, publish-image.test.mjs, resolve-ui-image.test.mjs and ghcr-images.test.mjs; 47/47 pass, zero skips, including OCI manifest IDs, absent tags, collisions and alias drift.
  - [x] Local test command: make test-ghcr-config-identity ENV=test-ghcr-publish-r2 (through docker-slot.sh, existing Node image; no build).
  - [x] Independent correctness and immutable-publication reviews GO on code diff SHA-256 17e3809f98a332b4c7f30d4efcb28b9504f2b66f68353dca3038d9979d89d198; scope C1/C2 and whitespace pass; no application, version or lock change.
  - [ ] Cleanup, push, open one READY PR, write final state and EXIT without CI polling.
