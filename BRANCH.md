# Feature: @sentropic/artifacts/live-host — single home for host-run and host-verified live code

## Objective
- [ ] Additive subpath `@sentropic/artifacts/live-host` (ships as 0.2.20 in train 1a): the single candidate digest, the SG4b handoff and receipt with key ids, the live host assertion and control formats, and the host build API types. api, artifact-content and immo import it.

## Scope / Guardrails
- [x] Branch feat/artifacts-live-host from origin/main 3f1027496; worktree tmp/worktrees/artifacts-live-host; ENV=test-live-host.
- [x] Architect decision: .tmp/rv/reviews/batch-w3-w5-w7-netpol.md (W3 item 3, W7 changes 1-5).
- [x] Sources: feat/alive-w3 97848a16f (candidateManifestDigest), feat/alive-w7 1dd2155a4 (handoff, host recheck), feat/alive-w9 148ae6092 + live-format WIP (assertion, control, fence), feat/alive-w8 84571090e (opaque string revisions).
- [x] Make only; no Python, attribution trailers, CI skips, reruns or CI polling; never ENV=dev.
- [x] Wagon: push the branch, no PR, no version bump, no CHANGELOG, lock or manifest regeneration (train 1a owns them).
- [x] Existing exports unchanged; pure Node crypto, no new dependency.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/live-host/**`
  - `packages/artifacts/tests/live-host-*.test.ts`
  - `packages/artifacts/tests/transport-exports.test.ts`
  - `packages/artifacts/package.json` (exports map only)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `apps/**`
  - `package-lock.json`
  - `packages/artifacts/CHANGELOG.md`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`

## Feedback Loop
- [ ] `attention`: W3, W7 and W9 switch their imports to `@sentropic/artifacts/live-host` and delete their local copies.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** (wagon merged by the train 1a integration lane)

## Plan / Todo (lot-based)
- [x] **Lot 1 — Candidate digest**
  - [x] One `candidateDigest` with §8.3 ceilings, safe paths, no file/directory conflict, pinned test vectors.
- [x] **Lot 2 — SG4b handoff**
  - [x] `kid` in claims and receipt; key resolvers for rotation overlap; Ed25519 only.
  - [x] Typed §8.3 final recheck (`publicationRecheck` over the locked host view) inside the host transaction, every refusal tested.
- [x] **Lot 3 — Live assertion and control**
  - [x] Prefix-bound HMAC formats (v1 assertion, c1 control, f1 fence) moved whole from W9 33c077e91; opaque bounded string `sourceRevision`; pinned token vector.
- [x] **Lot 4 — Host build API and export map**
  - [x] Request/response types and parsers (signed job request, handoff request, closed refusal bodies); `./live-host` export; built export map test.
- [x] **Lot 5 — Gate**
  - [x] `make typecheck-artifacts`, `make lint-artifacts`, scoped `make test-artifacts SCOPE=...` (live-host 56/56, transport-exports 1/1).
  - [x] Push the wagon; report .tmp/rv/live-host.md.
