# Feature: cluster-mesh 0.13.0 train package — Lot D B3d

## Objective
- [ ] Deliver the cluster-mesh 0.13.0 candidate of the Lot D release train (mesh 0.22.0 → gateway 0.19.0 → cluster 0.13.0) per `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md` §10 (B3d), §12.1, §12.4, §12.6 and the approved release-train design v3 (package part only).

## Scope / Guardrails
- [x] Branch `feat/cluster-mesh-013`, worktree `tmp/cluster-mesh-013`, based on `feat/llm-gateway-budget` (mesh 0.22.0 + gateway 0.19.0 candidates).
- [x] Make-only checks; Docker-first; no Python; English text; `ENV=test-cluster-mesh-013` last; never `ENV=dev` or `clean-all`.
- [x] Ports reserved if a service starts: API `9464`, UI `5664`, Maildev UI `1564`.
- [x] Selective staging and separate `make commit`; update checkboxes in each atomic commit, approximately 150 lines maximum.
- [x] HARD STOP: no push, no PR, no merge, no publication (train only).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/**` (incl. `packaging.mk`, `tests/packaging/**`, fixtures, README, CHANGELOG)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**` (EX10 not authorized yet)
  - `.track/**`
  - `plan/**`
  - `deploy/**`
  - `packages/llm-mesh/**`, `packages/llm-gateway/**` (frozen candidates), other `packages/**`, `api/**`, `apps/**`
  - `packages/cluster-mesh/src/hono/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - root `package-lock.json` refresh through Make for the train versions (BRDP-EX6)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `attention`: BRDP-EX6 — root `package-lock.json` workspace entries move to mesh 0.22.0 / gateway 0.19.0 / cluster 0.13.0 (lock-sync assertion of the train); applied with the editing tool on the three `packages/<slug>` entries only (version and manifest ranges mirrored), because `make lock-root` runs a full workspace install writing node_modules into the worktree; rollback = revert the lockfile hunk with this lot.
- `attention`: owner decision — gated module ids `focus`, `cli`, `build-cli` removed from `CLUSTER_MESH_GATED_MODULE_IDS`/`ClusterMeshModuleId` (public union change, CHANGELOG); the `/cli` transport namespace of `src/hono/cli-router.ts` is a separate `ClusterMeshNamespace` from `@sentropic/contracts` and stays untouched (`src/hono/**` forbidden).
- `attention`: npm 11.19 does not fail the plain old-tuple install with ERESOLVE: it exits 0 after "ERESOLVE overriding peer dependency" and drops both conflicting root requests (0.12's gateway-017 case failed with ERESOLVE); `--force` does the same. Outcome `refused` = old tuple not installed (exit code and installed versions recorded in `npm-install-detail`); the skewed tree for the runtime refusal is built with `--legacy-peer-deps`.
- `attention`: global consumer + separately installed runtime with `file:` siblings + `overrides` is green; a one-off experiment without `overrides` was also green (the runtime's direct `file:` sibling satisfies gateway's `^0.22.0` edge, registry never queried), so no placeholder fallback beyond `__LLM_MESH__`/`__LLM_GATEWAY__` substitution was needed.
- `attention`: registry mode (no `SIBLING_ARCHIVES_FILE`) fails at `selected` `npm ci` with 404 until mesh 0.22.0 / gateway 0.19.0 are published (fail-safe, expected by the train design); CI still needs EX10 (siblings before the lazy qualification) — ci.yml untouched here.
- `attention`: every sibling in a receipts file is validated (guard, path, sha256, packed identity) before any use; an invalid receipt fails the run rather than falling back to the registry.

## AI Flaky tests
- [x] Not applicable: deterministic unit and packed-install tests, no provider call.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** (Lot D wave 3; train integration by the conductor)
- Rationale: B3d is a cluster-mesh-only lane cherry-picked into the conductor train branch.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read spec §10 (B3d), §12.1, §12.3, §12.4, §12.6 and train design v3.
  - [x] Verify branch, registry latest cluster-mesh `0.12.0` (target `0.13.0` free), mesh `0.21.2`, gateway `0.18.0`.
- [ ] **Lot 1 — Manifest, catalog and module ids**
  - [x] `package.json` 0.13.0, peers mesh `>=0.22.0 <0.23.0`, gateway `>=0.19.0 <0.20.0`; `catalog.ts` ranges equal.
  - [x] Remove `focus`, `cli`, `build-cli` gated module ids; CHANGELOG.
  - [x] Unit tests and fake package trees moved to the new tuple; `{ '/gw': '/' }` remap case.
- [ ] **Lot 2 — Packed qualification (train design §2b-d)**
  - [x] `packaging.mk` `SIBLING_ARCHIVES_FILE` (exact path) and `check-train-lock-integrity`.
  - [x] `prepare.sh` sibling resolver with sha256/identity check and registry fallback, `sources.txt`, provisional `selected` mode, lock with registry `resolved` and sibling integrity.
  - [x] Fixtures on 0.22.0/0.19.0/0.13.0; old-tuple (0.21.2/0.18.0) refusal at install and runtime; packed missing-jose refusal.
  - [x] Global consumer + separately installed runtime with `file:` + `overrides` proven.
- [ ] **Lot 3 — Docs, lockfile and proof**
  - [ ] README compatibility matrix and remap line; root lockfile (EX6).
  - [ ] Export diff artifact 0.12.0 (published) vs 0.13.0 (packed).
  - [ ] Gate: typecheck/test/build/pack cluster-mesh, packed `test-lazy-package` with siblings, `test-llm-mesh`, `test-llm-gateway`, `scope-check`.
