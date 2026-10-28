# fix(cluster-mesh): carry Engram 0.21.3 intentHash

## Objective
- [x] Persist and return Engram 0.21.3 `unit.intentHash` byte for byte; bind final neutral contract 1.0.0 bytes and deliver pack-only dev.6.

## Scope / Guardrails
- [x] Base `origin/feat/engram-e2-integration`; branch `feat/cluster-mesh-engram-e10a3`; worktree `tmp/worktrees/mem-e10a3`; draft PR against `feat/engram-e2-integration`; merge only, never rebase or force-push.
- [x] `ENV=test-mem-e10a3` last; no service ports needed; no dev environment, clean-all, Python, publication or AI trailers.
- [x] Every Docker step uses `/home/antoinefa/.cache-tmp/sentropic-docker.lock`, followed by `make down`; commits at most 150 changed lines through `make commit`.
- [x] Contract identity 1.0.0 / `memory-binding-v1`; manifest SHA-256 `55f8d4572db7100e4dba0a135331cdeb1186458711f0c7202e5f0cd93a6dc759`; module digest `sha256:dd0cccbd6e5e29766fbc9c48351ffe58f5b0a3162152f5ff02da0798c3244fee`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/engram-memory/**`
  - `packages/cluster-mesh/tests/engram-memory/**`
  - `packages/cluster-mesh/assets/storage/engram-memory/**`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
  - `package.json` (retain the Engram-scoped officeparser security override on 0.21.3)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/engram/**`
  - `api/**`
  - `ui/**`
  - `.github/workflows/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` (BR10a-EX1: Engram peer-tool pin only)
- **Exception process**:
  - [x] BR10a-EX1: cold-workspace Engram pin 0.21.3 so CI executes the requested producer; impact limited to test dependency; rollback manifest/lock/peer pin together; authorized by requested E2 re-pin.

## Feedback Loop
- [x] Gate `.tmp/packets/mem-E10a2-review-gate.md`: preserve K7 fields, separate kernel digests, pin byte round trips and refuse divergent capture receipts.
- [x] Fetched base actually pins 0.21.1; replace directly with published 0.21.3 and regenerate lock from registry.
- [x] BR10a-EX1: `Makefile` peer-tool pin only; requested producer re-pin; rollback with package manifest and lock.
- [x] Independent blind review of `eb79034df17ed5e2cb2ddcc3288b9b8bbb682120`: Claude-hosted GPT-6 Astra/high and GPT-6 Luna/high both PASS; reconciled dossier in E10 artifacts `e10a3-review/dossier.md`.
- [x] Local full suite: 1,402 passed, 268 conditional skips, zero type errors; PostgreSQL-dependent qualification is retained in CI.
- [x] Pack guard refused the shared directory containing older archives; reuse the completed build, pack into a fresh directory and copy dev.6 to the requested E10 artifacts directory.

## AI Flaky tests
- [x] No AI provider tests; no timeout increases or flaky acceptance.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (merge only).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Inputs**: published receipt, rules and gate read; isolated branch created; mechanical harness branch check passed.
- [x] **Lot 1 — Producer and contract**: re-pin package/peer/registry lock, bind final manifest bytes and digest; bump pack-only 0.24.0-dev.6.
  - [x] Exact 0.21.3 registry integrity verified in regenerated lock; 0.24.0-dev.6 exceeds published 0.23.4; root and peer-tool pins aligned.
- [x] **Lot 2 — Intent carriage**: delete runtime/test host formula; persist supplied intentHash and return unchanged.
- [x] **Lot 3 — Tests**: wire-adaptation, contract-vectors, binding compatibility and receipt host; real 0.21.3 persistence/replay/tamper tests; receipt divergence negative test.
  - [x] New installed-producer test passes: persisted/returned UTF-8 bytes, Engram's own replay comparison and `DIGEST_CONFLICT` on tampered storage.
- [x] **Lot 4 — Validation**: typecheck, lint, cluster-mesh suite, binding/Comments contract gates and scope; shared Docker lock and cleanup.
- [x] **Lot 5 — Artifact**: pack-only dev.6, copied tarball and SHA-256 to E10 artifacts; independent review completed.
- [ ] **Lot 6 — PR / CI**: draft against `feat/engram-e2-integration`; completed/success CI on the exact pushed head; final CI receipt recorded in the PR body after completion.

## Test Plan / UAT
- [x] `tests/engram-memory/intent-carriage.spec.ts`: installed 0.21.3 producer bytes, Engram replay comparison, stored-digest tamper refusal.
- [x] `tests/engram-memory/wire-adaptation.spec.ts`: opaque intent bytes, K7 and journal round trips.
- [x] `tests/engram-memory/receipt-hydration.spec.ts`: installed hydration refuses divergent K7/control receipts, both capture states.
- [x] `tests/engram-memory/contract-vectors.spec.ts`, `binding-compatibility.spec.ts`: manifest/declaration hashes and installed structural compatibility.
- [x] Cluster Mesh typecheck, lint and full suite, including binding and Comments contract regression gates; no UI interaction required.

## Pack-only Delivery
- [x] `@sentropic/cluster-mesh@0.24.0-dev.6`; no publication.
- [x] Archive: `/home/antoinefa/src/sentropic/.tmp/engram-e2-host-tuple/e10-artifacts/sentropic-cluster-mesh-0.24.0-dev.6.tgz`.
- [x] SHA-256: `ff79088e02574f9e17e16deb52f9380453255ed79f5b69c8b17d156a25233194`; manifest guard PASS (`standalone-default`, blocking mode).
- [x] Packed runtime contains direct `digest: unit.intentHash` and `intentHash: row.digest`; packaged manifest bytes exactly match the supplied 4,012-byte JCS file.
