# Feature: A-LIVE W7 — builder service, host build API and SG4b two-step handoff (M3-B)

## Objective
- [ ] Builder service composition, authenticated host build API (job by id, never a caller SHA) and the A-LIVE §8.4 two-step SG4b handoff, coded against the W3 `QualifiedSupervisor` port. Code only: merge and activation wait for the GB4-P go (A-LIVE §10).

## Scope / Guardrails
- [x] Branch feat/alive-w7 from origin/main 3f1027496; worktree tmp/worktrees/alive-w7; ENV=test-alive-w7.
- [x] Plan .tmp/rv/alive-enablement-plan.md (W7, lot M3-B); contracts A-LIVE v2 and G0 v3; immo reservations R1-R5.
- [x] Make only; no Python, attribution trailers, CI skips, reruns or CI polling; never ENV=dev.
- [x] Wagon: push the branch, no PR, no version bump, no lock or manifest regeneration.
- [x] Pod resources and NODE_OPTIONS belong to wagon feat/alive-pod-4live (plan r3.5); not changed here.
- [x] Nothing deployed or activated on any cluster.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/live/**`
  - `api/tests/unit/artifacts-live/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `apps/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (none planned: the handoff ledger reuses `control.artifact_host_kv`)
  - `.github/workflows/**`
  - `packages/artifacts/src/server/live-{store,mutations,read}.ts`, `packages/artifacts/src/server/{build-*,failures}.ts`, `packages/artifacts/tests/**` and `packages/cluster-mesh/src/{index.ts,runtime/heavy-phase-queue.ts}`, `packages/cluster-mesh/tests/heavy-phase-queue.spec.ts` (BRW7-EX1, BRW7-EX3: through the W8 and W5 merges only)
  - `api/src/routes/artifacts-builder.ts`, `api/src/app.ts`, `api/src/config/env.ts`, `ui/nginx/default.conf` (BRW7-EX2: product builder mount only)

## Feedback Loop
- [x] BRW7-EX1: wagon feat/alive-w8 @ edeb219a0 merged so the builder service composes its admission, heavy gate and invitations (s-archi batch 2, W7 item 5); impact: W8's files, its BRW8-EX1 package files included, enter this branch through the merge only, no W7 commit edits `packages/**`; rollback: revert the merge commit.
- [x] BRW7-EX1 (re-merge): feat/alive-w8 @ b97481f3d, W4 @ 128130a6d inside, for the queued heavy gate and the W4 bootstrap FIX5 composes; `recipes.ts` = W4 + W7 placement (s-archi 16:40); idle evidence set at `BUILD_QUEUED`; W4 tests take the placement and the GB1 cache source; rollback: revert the merge commit.
- [x] BRW7-EX4: wagon feat/alive-w3 @ 38a635b73 merged for `supervisorPublicKey` (FIX5) and the streaming cache; `worker.ts` = W8 structure + W3 signatures + W4 envs (s-archi 16:40); W3 tests take string revisions and the GB1 source, W4/W8 tests the streaming cache ports; rollback: revert the merge commit.
- [x] BRW7-EX3: wagon feat/alive-w5 @ 41078993c merged so the builder reads the GB1 qualification file through the W5 port `validateArtifactBuild` (s-archi 16:00 §1); impact: W5 package files enter this branch through the merge only, no W7 commit edits `packages/**`; rollback: revert the merge commit.
- [x] BRW7-EX2: product mount of the host build API under `/api/v1/artifacts/builder` (s-archi W7 builder mount, 07/11 15:25); impact: one route module, one `app.route` line, one optional env value and one ui nginx location without logs, inert until a builder service is composed (GB4-P); rollback: revert the mount commit.
- [x] `resolved` (s-archi batch review, W3 dae5b0f0a): W3 seals the snapshot into `SupervisorSources.candidate`; W7 provides that sink (`createCandidateStore`), which is also its `CandidateExport`.
- [x] `resolved` (s-archi batch review): the host verifier, the single `candidateDigest` and the handoff types live in `@sentropic/artifacts/live-host` (lane s-opus-live-host).
- [ ] `attention`: `apps/artifact-content/src/live.ts` still hard-codes the builders service domain (W9 scope, outside this branch).
- [x] `resolved` (FIX5): W4 and W3 merged (BRW7-EX1 re-merge, BRW7-EX4); the bootstrap is composed from the supervisor key, no `bootstrap` string port.
- [ ] `attention`: a lock without script entries and no qualification file digests zero bytes as its `IntegrityEvidence` digest; s-archi to confirm (16:00 §1 names no digest for the absent file).
- [ ] `attention`: product `createBuilderService` composition waits for the AL-T/AL-D ports (`sources.source`, `sources.draft`), the W9 relay `channel` and an AL-T forge port supplying `SourceSnapshot.gb1` (host base URL now `ARTIFACT_BUILDER_REMOTE_HOST_URL`); until then the mount answers 503 `builder_unavailable` to a bound host.
- [x] `resolved`: live-host 8ce4700e4 exports `./live-host` (`index.ts`, fa651158b); W7 imports only that subpath.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** (wagon merged by the train integration lane)

## Plan / Todo (lot-based)
- [x] **Lot 1 — SG4b two-step handoff**
  - [x] Ed25519 single-use authorization bound to job, generation, commit, candidate, run and attempt; 10-minute lifetime.
  - [x] Host verifier: mandatory evidence, foreign scope/job, replay, expiry, altered bytes, stored-bytes re-read, response-loss replay.
  - [x] Builder publication port: anti-repack check, durable intent, bounded resend, receipt verification, idempotent record.
- [x] **Lot 1b — s-archi changes**
  - [x] Builder namespace and service domain from per-environment configuration (`builderPlacement`).
  - [x] In-pod install `npm ci --offline --ignore-scripts`, no registry, no script allowlist.
  - [x] Pod spec without `activeDeadlineSeconds` (plan r3.9, A-LIVE Amendment 1, pending the immo co-signature).
  - [x] Job admission: `binding.pendingJobId === jobId` and a matching generation; monotonic host attempt fence.
  - [x] `expect()` contract: every A-LIVE §8.3 recheck, one test per refusal (`publicationRecheck`).
  - [x] Import `candidateDigest`, the handoff types, the verifier and the recheck from `@sentropic/artifacts/live-host` (78e85ffb7); `kid` in claims and receipt; api copies deleted.
- [x] **Lot 2 — Host build API and builder service**
  - [x] Authenticated host identity; job by id; asynchronous build with job-bound status (`createHostBuildApi`, `createBuildJobs`).
  - [x] Scheduler sweep (reconcile, reap, recover) stays exposed by the controller, never started here.
  - [x] `createBuilderService`: controller, SG4b publication, Postgres job ledger and host build API; nothing started.
  - [x] Postgres job ledger in the existing host KV (`createPostgresBuildJobStore`), sharing the live store row lock.
  - [x] Live recipe path stays `ui/vite.config.ts`: the only contract value (immo R1/R2); no new config invented.
- [x] **Lot 4 — s-archi builder mount (decisions 07/11 15:00-15:25)**
  - [x] Run staleness = heavy-gate wait plus the four bounded build-only phases (20 min), not a pod lifetime.
  - [x] Host identity from the `artifacts:builder` service client and `ARTIFACT_BUILDER_HOST_BINDINGS_JSON` (default deny).
  - [x] Builder handoff signing key and host receipt key ring from fixed env names, with a documented rotation cycle.
  - [x] Mount under `/api/v1/artifacts/builder` behind `createRequireServiceAuth`; ui nginx location without access log.
  - [x] Pod spec keeps main's resources and env (pod-4live owns them); namespace, placement and no `activeDeadlineSeconds` only.
  - [x] Builder-side HTTP `RemoteHost` on the live-host `HOST_BUILD_PATHS` (signed job request, handoff with candidate bytes).
- [x] **Lot 5 — s-archi 16:00 §1 (GB1 qualification file, remote host, keys)**
  - [x] Merge W5 @ 41078993c for the GB1 port `validateArtifactBuild` (BRW7-EX3).
  - [x] Read `artifact-build/gb1-qualification.json` at the pinned commit: 64 KiB, closed keys, empty execution allowlist, exact script-row cover, lock digest; missing file refused when the lock has scripts.
  - [x] IntegrityEvidence digest = SHA-256 of the qualification file; cache inventory from the W5 coverage (local copy deleted).
  - [x] Remote host base URL from `ARTIFACT_BUILDER_REMOTE_HOST_URL` (preprod `https://preprod.immo.sent-tech.ca/api/v1/artifacts`).
  - [x] Key env names and rotation documented with the remote host and the qualification file.
- [x] **Lot 6 — s-archi 16:35 (job resolution retry)**
  - [x] A 409 `job_not_pending` on the first job resolution is retried freshly signed (6 tries, 250 ms to 4 s, 7.75 s), then fails for good; every other answer is handled as is.
- [x] **Lot 7 — s-archi 16:40 FIX5 (supervisor frame key)**
  - [x] `ARTIFACT_SUPERVISOR_SIGNING_KEY_JSON` = `{kid, privateKey}` (Ed25519 PKCS#8) read by `supervisorKey`, refused when absent or invalid.
  - [x] `composeSupervisor`: the same key signs every W3 frame and yields `createBootstrapSource(supervisorPublicKey(key))`.
  - [x] Live service composes transport, bootstrap, cache install/stream and the candidate holder (sink and SG4b export).
  - [x] Single active key, rotated only after the live pods stop; it applies at the next revive (README).
- [x] **Lot 3 — Gate**
  - [x] Scoped checks: `make -f .tmp/packets/alive-w7-livehost.mk w7-check-livehost` against the pushed live-host tree (tsc + vitest, 70 tests).
  - [x] Push the wagon; report .tmp/rv/alive-W3-W7.md; `make down-volumes ENV=test-alive-w7`.
