# fix(cluster-mesh): freeze common v1 module list (0.21.3)

## Objective
Replace the live root-lockfile equality in the P1 packed gate with a versioned fingerprint of the resolved P1 dependency and build-tool closure.

## Scope / Guardrails
- Scope limited to P1 pre-candidate pack/verify, manifest schema, and tooling tests.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/worktrees/l5-p1-fingerprint`.
- Automated test campaigns on dedicated environment (`ENV=test-l5-fingerprint`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- Never run `make clean-all`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `README.md` (BR710-EX10; merge-only, exact origin/main content)
  - `docs/governance/**` (BR710-EX10; merge-only, exact origin/main content)
  - `package.json`
  - `package-lock.json`
  - `packages/cluster-mesh/**` (BR710-EX11; merge-only, exact origin/main content)
  - `Makefile` (BR710-EX1-7 P1 changes; BR710-EX11 main-only CLUSTER_MESH_PEER_TOOLS pin)
  - `ui/package-lock.json`
  - `ui/package.json` (merge-only, exact origin/main DOMPurify pin)
  - `api/Dockerfile` (BR710-EX9; preserve the main Go 1.26.10 pin during integration)
  - `tools/memory-mcp-l5/lock-fingerprint.mjs`
  - `tools/memory-mcp-l5/lock-closure.mjs`
  - `tools/memory-mcp-l5/build-inputs.mjs`
  - `tools/memory-mcp-l5/precandidate.mjs`
  - `tools/memory-mcp-l5/pack.mjs`
  - `tools/memory-mcp-l5/schemas/artifact-manifest-v1.schema.json`
  - `tools/memory-mcp-l5/tests/**`
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json`
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json.sha256`
  - `tools/memory-mcp-l5/artifacts/history/**`
  - `tools/memory-mcp-l5/artifacts/archives/**`
  - `tools/memory-mcp-l5/artifacts/lock-snapshots/**`
  - `tools/memory-mcp-l5/artifacts/toolchain/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/**`
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `.github/**`
  - `tools/memory-mcp-l5/receipt.mjs`
  - `tools/memory-mcp-l5/schema-validator.mjs`
  - `tools/memory-mcp-l5/schemas/checkpoint-v1.schema.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
- `attention`: BR710-EX11 — import PR 709 cluster-mesh files and its Makefile peer pin through the owner-authorized main merge. Reason: main advanced while CI ran. Impact: preserve upstream bytes exactly outside the branch P1 work. Rollback: revert the merge as a unit.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).
- `attention`: BR710-EX11 — import PR 709 cluster-mesh files and its Makefile peer pin through the owner-authorized main merge. Reason: main advanced while CI ran. Impact: preserve upstream bytes exactly outside the branch P1 work. Rollback: revert the merge as a unit.

## Feedback Loop
- `attention`: BR710-EX11 — import PR 709 cluster-mesh files and its Makefile peer pin through the owner-authorized main merge. Reason: main advanced while CI ran. Impact: preserve upstream bytes exactly outside the branch P1 work. Rollback: revert the merge as a unit.
- `attention`: BR710-EX10 — allow README.md and docs/governance/** imported by the owner-authorized merge of main (4138a0ecb, PR #711). Reason: preserve both branches while scope-checking the merge index. Impact: upstream content only, byte-identical to origin/main, no local edits. Rollback: revert the merge as a unit.
Actions with the following status should be included around tasks only if really required (cf. Task 1 feedback loop):
- subagent or agent requires support or informs: `blocked` / `deferred` / `cancelled` / `attention`
- conductor agent or human brings response: `clarification` / `acknowledge` / `refuse`
- `attention`: BR710-EX1 — pin `@types/node@22.20.1` in `Makefile` P1-producing targets and pass the committed lock sha to the packer (4 recipe tokens, bare `@types/node` and no provenance binding today).
- `attention`: BR710-EX2 — add `Makefile` target `lock-markdown-it-direct` (pinned sed bump 14.3.0/14.1.1→14.3.2, mirrors committed `lock-api-direct` precedent; full npm regen is ERESOLVE-blocked per the comment above that target).
  - Reason: remediate the CI-blocking markdown-it HIGH pair (GHSA-253c-mchw-3w2r fixed in 14.3.1, GHSA-r7fv-28h4-cvq7 fixed in 14.3.2) with registry-pinned integrity; dep ranges of 14.3.x are identical so the 3-line delta is exact.
  - Impact: root + ui locks resolve markdown-it 14.3.2; P1 closure untouched (no P1 regen).
  - Rollback: revert the target, the override, and the two lock hunks.
  - Reason: the P1 build toolchain installs an unpinned `@types/node` (floating `latest`); the fingerprint must bind the actual resolved toolchain deterministically (Astra R1 finding 2). Pin matches `packages/mcp-*/devDependencies ^22.10.10` and the lock nested resolution `22.20.1`. The `--head-lock-sha` provenance arg enforces generation from the committed lock (Astra R1 finding 3); host-shell evaluation matches the existing `--l5-head`/`--base` args since the pack container cannot read the worktree gitdir.
  - Impact: build `@types/node` becomes `22.20.1` instead of floating latest; `pack.mjs` refuses a dirty lockfile; `typecheck-*`/`test-*` targets untouched.
  - Rollback: revert the 3 tokens to bare `@types/node` and drop the `--head-lock-sha` arg.
- `attention`: BR710-EX3 — install the P1 build toolchain via `npm ci` from a committed union toolchain snapshot and add the explicit `memory-l5-toolchain-snapshot` regen target (3 recipe install tokens + 1 additive target).
  - Reason: Astra R2 finding 2 — the recipes fresh-install transitive ranges, so root-lock records describe a different installation (api-extractor 7.58.12 vs actual 7.58.9). One resolved toolchain record must be consumed by the producing build and checked by the verifier.
  - Impact: builds install the byte-identical locked tree (same direct pins `typescript@5.4.5 @types/node@22.20.1 @microsoft/api-extractor@7.58.9`); snapshot regen is explicit and reviewable; fingerprint v3 binds snapshot content plus spec satisfaction; all other targets untouched.
  - Rollback: revert the 3 install tokens to `npm install <specs>` and drop the snapshot target; keep or revert the `v3` modules with the snapshot files retained.
- `attention`: BR710-EX4 — remediate the NEW markdown-it advisories (GHSA-vfgh-jcmw-g37q low, GHSA-gfr2-rv44-r23c high; fixed in 14.3.3) with the same pinned-sed procedure as BR710-EX2 (root `overrides` 14.3.2→14.3.3, lock bumps in root + ui, integrity var + bump target).
  - Reason: CI audit-gate/SCA red on the R2 head (6 jobs plus `ci-gate`); the advisories were published after the last green run and are unrelated to the R2 diff (identical ui/api locks were green at `27a560ce4`).
  - Impact: markdown-it 14.3.2→14.3.3 in root + ui locks only; P1 closure untouched (no P1 regen — `memory-l5-verify` proves it).
  - Rollback: revert the override, both lock hunks, and the target/var.
- `attention`: BR710-EX5 — remediate the follow-redirects HIGH pair (GHSA-q3jh-wrc6-jgq8, GHSA-8r9p-f939-6h3c; fixed in 1.16.1) with the same pinned-sed procedure (root `overrides` pin, root lock hunk, integrity var + bump target).
  - Reason: CI `build-api-image` + `security-sast-sca` red on the post-EX4 head; the advisories were published mid-run (narrow `>=1.16.0 <1.16.1` range, single parent `centra ^1.15.6`); unrelated to the R2 diff.
  - Impact: follow-redirects 1.16.0→1.16.1 in the root lock only; P1 closure untouched (no P1 regen — `memory-l5-verify` proves it).
  - Rollback: revert the override, the lock hunk, and the target/var.
- `attention`: BR710-EX6 — remediate the vite launch-editor advisories (GHSA-587h-7wmj-h5pm HIGH incl. CVE-2026-112942, GHSA-698v-4r3x-3vcv medium, GHSA-r825-w8mm-5pxw medium; vite fixed in 7.3.7/8.2.4) with the same pinned-sed procedure (root + api lock hunks, integrity vars + bump target; no single-version override exists across the 7/8 lines so none is added).
  - Reason: CI `security-sast-sca` (api workspace, dev included) + `security-container` (api-tool image) red; advisories published 10/20, after the last green run; unrelated to the R2 diff.
  - Impact: vite 7.3.6→7.3.7 (root top) and 8.2.2→8.2.4 (root nested ×2, api nested ×1); ui/auth-idp vite copies untouched (their gates green, minimal diff); P1 closure untouched (no P1 regen — `memory-l5-verify` proves it).
  - Rollback: revert the lock hunks and the target/vars.
- `attention`: BR710-EX7 — add one effective-image equality guard line to each of the 3 P1-producing `Makefile` recipes plus the `memory-l5-pack` recipe (Astra R3 P1: execution-contract enforcement).
  - Reason: the finding's invocation-level repro (`make memory-l5-pack LLM_MESH_NODE_IMAGE=node:22 ...`) changes the effective image of every producing recipe without touching recipe text; the parser requires the guard and the fingerprint binds it, but only a recipe-executed equality test refuses the override before anything is produced.
