# Feature: ArtifactStorePort (BR-52) — object/artifact plane port over storage-s3 + local-FS

## Objective
Introduce `ArtifactStorePort` (SPEC_EVOL_DATA_ARCHITECTURE §3.5 Axis E, line 318): a port over the object/artifact plane that wraps `storage-s3.ts`, adds checksum/metadata/versioning, and ships two bindings (S3-compatible + local-FS for dev/self-host). Prove activation by routing one real consumer through the port. Not gated on ARCH-11 (no tenant-model decision; no published contract).

## Scope / Guardrails
- Scope limited to the artifact/object storage plane (`api/src/services`), one consumer rewire, env config additions.
- No migration in `api/drizzle/*.sql` (this branch adds no schema).
- Make-only workflow, no direct Docker commands.
- Root workspace `ENV=dev` reserved for user dev/UAT; must remain stable.
- Branch development happens in isolated worktree `tmp/artifact-port`.
- Automated tests run on dedicated env (`ENV=test-artifact-port`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.
- Ports (branch nn=52, slot 0): API `9260`, UI `5460`, Maildev UI `1360`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/artifact-store/**`
  - `api/src/services/storage-s3.ts` (additive optional metadata only; backward-compatible)
  - `api/src/services/context-document-source.ts` (Lot 2 activation — single consumer rewire)
  - `api/src/config/env.ts` (additive optional env vars only)
  - `api/tests/artifact-store/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - all other `storage-s3.ts` consumers (deferred to follow-up)
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql` (none expected)
  - `.github/workflows/**` (none expected)
- **Exception process**:
  - Declare exception ID `BR52-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- `acknowledge`: BR-61 ubo-storage (the natural first consumer of this port) is GATED on ARCH-11 tenant semantics (D0). BR-52 is the non-gated foundation; remaining `storage-s3` consumers migrate in a follow-up once the port is proven.
- `acknowledge` (BR52-REV1, Codex 5.5-xhigh adversarial review of Lot 1, all fixed): (1) BLOCKER local-FS path traversal via `..` bucket/key segments → `sanitizeSegment` neutralizes `''`/`.`/`..` + path-containment assertion; (2) MAJOR `.meta.json` sidecar collided with valid keys → split into `blobs/` + `meta/` subtrees; (3) MAJOR S3 not-found not normalized → `asNotFound` maps `NoSuchKey`/`NotFound`/404 to `ArtifactNotFoundError`; (4) MAJOR versioning declared-but-unimplemented → `version` field dropped from v0 (S3 VersionId pass-through deferred to follow-up; avoids expanding shared `storage-s3` return surface). Clean: checksum-as-S3-metadata lowercase round-trip, `DOC_STORAGE_BUCKET` auto-selection.

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (≥1 success on same commit+command). Never add timeouts. Analyze vs `main`: unrelated → accept + record; related → blocking.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single orthogonal capability; single final test cycle)
- [ ] **Multi-branch**
- Rationale: one self-contained port + adapters + one activation; no independent sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI surface changes → no interactive UAT; validation is API tests + e2e non-regression on document flows (the rewired consumer path).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/architecture.md`, `plan/BRANCH_TEMPLATE.md`, `spec/SPEC_EVOL_DATA_ARCHITECTURE.md §3.5`.
  - [x] Create isolated worktree `tmp/artifact-port` from `origin/main` (post-#312); `cp ../../.env .env`.
  - [x] Confirm scope, guardrails, env mapping (`test-artifact-port`).
  - [x] Confirm command style: `make ... ENV=<env>` with `ENV` last.

- [ ] **Lot 1 — Port + adapters + factory + unit tests**
  - [ ] `artifact-store/port.ts`: `ArtifactRef`, `ArtifactMetadata`, `PutArtifactInput`, `PutArtifactResult`, `ArtifactStorePort` interface (`put`/`getBytes`/`getStream`/`head`/`delete`/`defaultBucket`).
  - [ ] `storage-s3.ts`: extend `putObject` with optional `metadata?: Record<string,string>` (set `Metadata`); extend `headObject` to return `metadata?: Record<string,string>` — additive, backward-compatible.
  - [ ] `artifact-store/s3-artifact-store.ts`: `S3ArtifactStore` delegating to `storage-s3` fns; sha256 on put; persist checksum in S3 object metadata; head reads it; pass-through `version` (S3 VersionId where present).
  - [ ] `artifact-store/local-fs-artifact-store.ts`: `LocalFsArtifactStore` under `ARTIFACT_FS_ROOT`; key→sanitized path; `.meta.json` sidecar for contentType/checksum; round-trippable.
  - [ ] `artifact-store/index.ts`: `getArtifactStore()` factory (env-selected: `ARTIFACT_STORE_BACKEND` override, else auto: S3 when `DOC_STORAGE_*` configured else local-fs) + singleton + re-exports.
  - [ ] `config/env.ts`: add optional `ARTIFACT_STORE_BACKEND`, `ARTIFACT_FS_ROOT`.
  - [ ] **API tests** (`api/tests/artifact-store/artifact-store.test.ts`): LocalFs round-trip (put→getBytes/getStream→head→delete); checksum determinism + expectedChecksum mismatch rejection; missing-key error; sidecar metadata; S3 adapter delegation via mocked `storage-s3` (checksum metadata set on put, read on head).
  - [ ] Lot gate: `make typecheck-api` + `make lint-api` + `make test-api ENV=test-artifact-port` (scoped to `tests/artifact-store` while iterating, full before push).
  - [ ] Design consensus: adversarial review of `port.ts` (Codex 5.5-xhigh) before push (reversible-decision discipline).

- [ ] **Lot 2 — Activation (one consumer through the port)**
  - [ ] Rewire `context-document-source.ts`: replace direct `getObjectBytes({bucket,key})` with `getArtifactStore().getBytes({bucket,key})` (byte-identical via S3 adapter).
  - [ ] Lot gate: `make typecheck-api` + `make lint-api` + `make test-api ENV=test-artifact-port`.
  - [ ] E2E non-regression: document/context flows (group covering documents) green on CI.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint (api).
  - [ ] Retest API (`make test-api ENV=test-artifact-port`).
  - [ ] Retest e2e (CI groups; document flows).
  - [ ] PR using `BRANCH.md` as body; verify branch CI; resolve blockers.
  - [ ] On CI green: commit removal of `BRANCH.md`, push, merge (preprod-only per mandate D2).
