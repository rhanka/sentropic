# Feature: GPT-6 Fix 3 — Cluster Mesh train lock

## Objective
- [x] Qualify Cluster Mesh against the committed llm-mesh 0.22.1 sibling bytes.

## Scope / Guardrails
- [x] Branch `feat/llm-mesh-gpt6`, worktree `tmp/llm-mesh-gpt6`; harness branch check passed.
- [x] Make-only Docker checks; `ENV=test-llm-mesh-gpt6` last; API 9472, UI 5672, Maildev UI 1572.
- [x] Commit below 150 changed lines; no attribution, push, PR, merge or publication.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/tests/packaging/**`
- [x] **Forbidden Paths (must not change in this lot)**:
  - `packages/cluster-mesh/src/**`
  - `packages/cluster-mesh/package.json`
  - `packages/llm-mesh/**`
  - `packages/llm-gateway/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
- [x] **Conditional Paths**: none.
- [x] Exception BRG6-EX2: owner-approved packaging tests/fixtures extension for Fix 3.

## Feedback Loop
- [x] BRG6-EX2 acknowledge: stale train pin blocks CI; impact limited to Cluster Mesh packaging tests/fixtures, no source/version change; rollback: revert this fix commit.
- [x] G6-13 attention: preserve supported peer ranges and old-tuple 0.21.2 refusal; change only selected train pins and keep mismatch cases distinct.
- [x] G6-14 attention: independent review and push remain conductor responsibilities per launch packet.

## AI Flaky tests
- [x] No live model calls or flaky acceptance.

## Orchestration Mode (AI-selected)
- [x] Mono-branch implementation; conductor handles independent review.

## UAT Management (in orchestration context)
- [x] Tests/fixtures only; no web, Chrome or VSCode UAT surface.

## Plan / Todo (lot-based)
- [x] Lot 0: rules/template, branch, CI context contract and PR #618 lock-refresh precedent inspected.
- [x] Lot 1: update prepare.sh, selected/package.json, optional-install, release-matrix, release-matrix-sources, siblings, lock-integrity and lock-integrity-registry specs; regenerate selected/package-lock.json.
- [x] Lot 2: packed qualification, full Cluster Mesh suite, scope check, hashes and gateway lock comparison.
- [x] Lot 3: environment cleanup; deliver this lot via selective staging and make commit; no push.

## Checks and Candidate Evidence
- [x] PASS `make pack-candidate-siblings PACKAGE=cluster-mesh SIBLING_DIR=tmp/ci-manifest-guard/siblings/cluster-mesh MANIFEST_CONTEXT_FILE=tmp/gpt6-fix3-context.json ENV=test-llm-mesh-gpt6`; pull_request context uses merge-base and origin/main...HEAD files; two BLOCK receipts.
- [x] PASS `make -f packages/cluster-mesh/packaging.mk refresh-lazy-package-lock SIBLING_ARCHIVES_FILE=tmp/ci-manifest-guard/siblings/cluster-mesh/receipts.json ENV=test-llm-mesh-gpt6`.
- [x] Mesh SHA-512 `sha512-5kf9hCzBfPsgFojUYKfzpOY+3B0yUtJqHXqmYbdj23ZB2+L53up0WIwvW4VzUqnGtwsxFempU9ugQ3uQo8KuPg==` equals CI reference and refreshed lock.
- [x] Mesh archive SHA-256 `4ed4e32c11d5dd58b38695c5147a6d15df41bcea04381862f606e05f426f9385`; packed from d56e700d2 with no llm-mesh working diff; equals Fix 2 candidate.
- [x] Gateway lock entry unchanged from HEAD; version/resolved/integrity exactly match public registry 0.19.0 metadata; lock diff changes only four mesh lines.
- [x] PASS `make -f packages/cluster-mesh/packaging.mk test-lazy-package SIBLING_ARCHIVES_FILE=tmp/ci-manifest-guard/siblings/cluster-mesh/receipts.json ENV=test-llm-mesh-gpt6` (10 files, 63 tests; both sibling integrities match).
- [x] PASS `make test-cluster-mesh ENV=test-llm-mesh-gpt6` (394 passed, 34 packaging-only skips covered above).
- [x] PASS `make scope-check ENV=test-llm-mesh-gpt6` (C2); `git diff --check`; only BRG6-EX2 paths changed.
- [x] PASS `make down API_PORT=9472 UI_PORT=5672 MAILDEV_UI_PORT=1572 ENV=test-llm-mesh-gpt6`; same arguments with `make ps` confirm no services.
