# Feature: SG2 GitPort GitHub App

## Objective
- [x] Deliver the G0 FROZEN v3 GitPort with enrolled cluster-mesh leases and fake-forge acceptance for the 0.2.18 train.

## Scope / Guardrails
- [x] Branch `feat/git-artifact-sg2`; worktree `tmp/worktrees/sg2`; base `train/artifacts-0.2.18` at `c107f6abd`; rebase reports up to date.
- [x] Binding contract SHA-256 `4c405c8f49e9d242d65eebe35a14a45e4826afc0007e9f94a7fe21d7404e21ba`; live owner decisions supersede CI execution.
- [x] Docker via docker-slot.sh; make only; no Python, secrets in outputs or attribution trailers.
- [x] Ports `API_PORT=9590 UI_PORT=5790 MAILDEV_UI_PORT=1690 ENV=test-sg2`; ENV always last.
- [x] No versions, lockfiles, profile pins, existing fixtures or L5 regeneration; integration owns the release.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json` (required by `scripts/ci/ci-lockfile-installs.test.mjs`, enforced by `validate-publishable-manifests`).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/server/git-port*.ts`
  - `packages/artifacts/src/adapters/github-*.ts`
  - `packages/artifacts/src/index.ts`
  - `packages/artifacts/src/server/failures.ts`
  - `packages/artifacts/tests/git-port*.ts`
  - `packages/artifacts/tests/fixtures/git-port*.ts`
  - `packages/artifacts/docs/git-port.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `**/package*.json`
  - `.track/**`
  - `tools/memory-mcp-l5/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`

## Feedback Loop
- [ ] SG2-INPUT: converged-r2 source path in G0 is absent locally; requested its current location, use self-contained frozen G0 meanwhile.
- [ ] SG2-PROBES: P1–P3/P10 and real enrollment acceptance are unverified; fake tests do not authorize activation.
- [ ] SG2-CI: CI/integration conductor must admit the exact train base to ordinary PR CI and prove inherited train bumps. Current `ci.yml` excludes the train target and rejects unchanged public package versions. Preserve the no-bump instruction; acceptance is required PR checks green without bypass.
- [x] Publish the conductor's existing pristine train base at `c107f6abd` to permit a train-targeted PR; no train content or release allocation changed.
- [x] Conductor is the designated Track writer; import this branch plan and final report, no concurrent `.track` writes here.

## AI Flaky tests
- [x] No AI-dependent tests or flaky exception.

## Orchestration Mode (AI-selected)
- [x] Mono-branch build lane; consolidated review on the final train diff.

## UAT Management (in orchestration context)
- [x] Verify fake-forge path refusals, fixed-SHA pagination, atomic multi-file commit, attribution, CAS and lease isolation.
- [x] Keep real witness calls disabled without explicit enrolled host configuration.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, G0 v3, owner decisions and SG0-app port; create worktree and pass harness C1.
- [x] Lot 1: typed GitPort, read/write policy and SG0-app structural lease contract.
  - [x] Compose the exported port with required authorization and typed, sanitized forge failures.
  - [x] Define SHA-pinned source pages, materialized atomic changes and the injected SG0-app lease surface.
  - [x] Implement canonical path admission, secret exclusions and A1 allow/deny matching before transport.
- [x] Lot 2: fake forge tests in `tests/git-port.test.ts`, `tests/git-port-policy.test.ts`, `tests/fixtures/git-port-fake.ts`.
  - [x] Add traversal, secret-file, A1 denial precedence and repository-relative glob acceptance cases.
  - [x] Add an in-memory forge with atomic old-SHA comparison and immutable source snapshots.
  - [x] Exercise attribution, multi-file create/replace/delete, concurrent CAS, cursor identity and enrollment/revocation failures.
  - [x] Add fake-HTTP protocol tests, complete-tree refusal, object hashing and sanitized driver failures.
  - [x] Add read-budget/binary/symlink boundaries and a test-only witness adapter that remains off without enrolled host input.
  - [x] Cover ancestor rewinds, commit inspection, readable main refs and byte-exact BOM handling.
  - [x] Distinguish a missing branch, an unavailable forge and a lease that expired before ref submission.
  - [x] Correct the expiry assertion to require absence of `commitState`; the definite refusal has no indeterminate-outcome field.
- [x] Lot 3: GitHub transport, SHA-pinned directory pagination, commit objects and atomic conditional ref advance.
  - [x] Add bounded nonrecursive tree traversal with fixed-SHA resolution and symlink/gitlink refusal.
  - [x] Count repeated directory objects at each path toward the enumeration bound as well as caching their immutable contents.
  - [x] Add MAC-bound caller/scope/SHA pagination, UTF-8/base64 reads and explicit omission reasons across the total budget.
  - [x] Add bounded GitHub HTTP and smart-HTTP old/new-SHA compare-and-swap with sanitized, indeterminate outcome handling.
  - [x] Implement GitHub object creation, nonrecursive trees, verified blobs, branch creation and ancestry comparison.
- [x] Lot 4: server-resolved authorship, short-lived lease checks, test-only enrolled witness adapter and host docs.
  - [x] Document host authorization/custody composition, bounds, CAS recovery and unverified activation gates in `packages/artifacts/docs/git-port.md`.
  - [x] Materialize one multi-file child commit with human-directory author, App committer and frozen join trailers; preserve indeterminate ref outcomes.
  - [x] Expose commit inspection for SG3 reconciliation and use the durable intent timestamp for replayable commit objects.
  - [x] Add fail-closed lease admission, exact repository/permissions/expiry checks and host revocation fencing; no token cache.
- [ ] Lot 5: scoped tests, typecheck/lint, harness scope, early push, one ready train PR, CI green and volume cleanup.
  - [x] `make test-artifacts SCOPE=tests/git-port`: 75/75 passed (32 policy, 20 port, 14 boundaries, 9 HTTP); final source compilation passed.
  - [x] `make test-artifacts SCOPE=tests/provider-failures.test.ts`: 100/100 passed for the shared error-registry regression.
  - [x] `make typecheck-artifacts` and `make lint-artifacts`: passed; lint reports zero errors and three warnings in unchanged files-parity tests.
  - [x] Harness branch and whole-diff scope checks pass; `make scope-check` before every commit; commits stay below 150 changed lines.
  - [x] Reuse unchanged built prerequisites with make's `-o` option; run every Docker command through docker-slot.sh with the recorded ports and ENV last.
  - [ ] Required train PR CI green; current workflow admission and inherited-bump rule remain with the integration conductor.
  - [x] `make down-volumes API_PORT=9590 UI_PORT=5790 MAILDEV_UI_PORT=1690 ENV=test-sg2`: passed; no test stack remains.
