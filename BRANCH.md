# Fix: proxy-addr 2.0.8 + MCP SDK 1.31.0 + jose peer (GHSA-jqcg-44mw-7w3h, GHSA-6qxp-vccf-f47h)

## Objective
Fix two HIGH/CRITICAL advisories that fail the npm audit gate on fresh API image builds (both already on main, empty allowlist):
- proxy-addr < 2.0.8 (critical, GHSA-jqcg-44mw-7w3h) — fixed in b7a2b65e7 via override + lock bump.
- @modelcontextprotocol/sdk < 1.31.0 (high, GHSA-6qxp-vccf-f47h) — declared `^1.29.0`, resolved 1.30.0; fix = `^1.31.0` (resolves 1.32.1).
Owner decision (2026-10-06): fix jose first, then bump the MCP SDK — clean path, no register exception.
The jose clash (registry llm-gateway@0.19.1 peerOptional jose@^5.10.0 vs top-level jose@6.x) is pre-existing on main and blocked any `npm install` re-resolution. Widen the workspace peer to `^5.10.0 || ^6.0.0`, bump the gateway patch version, then regen the locks for real.

## Scope / Guardrails
- Scope limited to dependency resolution: `packages/llm-gateway/package.json` (peer range + patch bump), `api/package.json` (SDK range; proxy-addr override kept), root `package-lock.json` (clean regen).
- `api/package-lock.json` (standalone) intentionally untouched: nothing consumes it (no Dockerfile stage, no CI job, no make target reads it — verified by grep); its standalone regen still resolves registry llm-gateway@0.19.1 (old peer, ERESOLVE) until 0.19.2 is published. See attention item below.
- Make-only workflow, no direct npm/docker on host for lock changes (docker one-offs mirror make targets).
- Never ENV=dev, never make clean-all. Test ENV: `test-proxy-addr` (API 9490, UI 5690, maildev 1590), image registry `local`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-gateway/package.json` (jose peer widen + 0.19.1 -> 0.19.2)
  - `api/package.json` (SDK `^1.29.0` -> `^1.31.0`; proxy-addr override kept)
  - `package-lock.json` (root; Dockerfile + SCA gate + audit gate resolve from it)
  - `packages/cluster-mesh/tests/integrations/gateway-surface.spec.ts` (owner-authorized pin update: 3 assertions track the workspace gateway 0.19.1 -> 0.19.2; committed packaging fixtures pinning published 0.19.1 stay)
  - `BRANCH.md`
  - `.h2a/build/fix_report.md`
- **Forbidden Paths (must not change in this branch)**:
  - `api/package-lock.json` (standalone; see above — regen blocked pre-publish, consumed by nothing)
  - `packages/cluster-mesh/**` (no train bump; gateway ships alone, see attention item)
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `.security/vulnerability-register.yaml` (no exception: real fixes exist)
  - `.security/audit-allowlist.json` (must be pristine at commit)
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` (BRPA-EX1, granted below; no new target needed — lock-root + npm update sufficed)
- **Exception process**:
  - [x] BRPA-EX1 declared before touching Makefile (reason, impact, rollback below; carried from b7a2b65e7, untouched by this session).

## BRPA-EX1 — one-off `lock-api-direct` make target (carried, untouched)
- [x] Reason: `lock-api` needs a running api service, but the api image build fails its own audit gate until the lock is fixed (chicken-and-egg); empty REGISTRY also breaks `up-api-test` image refs. A full npm regen was impossible (pre-existing ERESOLVE, see above). The 2.0.8 delta is 3 lines per lock (registry-pinned integrity), applied by the target with verification.
- [x] Impact: additive only (new target + two pinned-hash variables); no existing target behavior changed.
- [x] Rollback: delete the `lock-api-direct` block; locks remain valid without it.

## Feedback Loop
- [x] `attention`: cluster-mesh bare packed qualification (`test-lazy-package`, no sibling receipts) can only install PUBLISHED train versions. Workspace gateway 0.19.2 is unpublished until merge-publish, so `selected-session`/`latest` fixtures ETARGET (`No matching version found for @sentropic/llm-gateway@0.19.2`, reproduced locally) and the `selected` tuple assertion expects the workspace version. On PR CI the sibling-pack step is skipped when cluster-mesh itself is unchanged (proven: PR #643 run 37551307387, siblings SKIPPED, bare qualify ran) so validate-cluster-mesh will stay red on this PR until 0.19.2 is published (owner/conductor bootstrap or merge-publish). Reverting the bump is NOT an option: the pack guard errors `bump required` when a changed manifest keeps an already-published version (`publishable-manifests.mjs` bumpGate, DEP_SECTIONS includes peerDependencies). Committed `selected` fixtures pin the published 0.19.1 train and must stay. Recorded in fix_report.md for conductor/owner.
- [x] `attention`: `api/package-lock.json` (standalone, consumed by nothing) still resolves SDK 1.30.0 + registry gateway 0.19.1. Its clean regen stays ERESOLVE-blocked until gateway 0.19.2 is published (registry 0.19.1 peer `^5.10.0` immutable, verified via `npm view`). Unblocks post-publish; then `make lock-api` (or deleting the stale file) applies. Not a gate input (Dockerfile + audit gate + SCA all resolve from the root lock).
- [x] `attention`: HIGH GHSA-68fv-2mgg-jv7q (source-map-js 1.2.1, dev-only: production `npm audit --omit=dev` reports 0 HIGH) still fails `make test-api-security-sca` (Trivy scans dev too) on this branch AND on main (Trivy DB newer than main's last green run 2026-10-06). Needs its own dedicated branch per security discipline — not smuggled in here, no register exception added.
- [x] `acknowledge`: dev-stack make targets after a `build-api-image` in the same worktree reuse the recorded production digest (`API_IMAGE_REF` from `.tmp/ci-prod-image/api-image-id`, gitignored) and fail with `npm: not found` (production strips npm by design). Fix is invocation-only, no file change: prefix dev-stack commands with `API_IMAGE_REF=` (empty value) (same convention `build-api-image` itself uses). Final production rebuild re-aligns tag + receipt; `verify-api-image` passes again.
- [x] `acknowledge`: local runs used no allowlist/register change; `.security/audit-allowlist.json` pristine, generated SCA artifacts gitignored (tree shows only the 3 intended files).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Branch `fix/proxy-addr-cve` confirmed; worktree root; base `52c1fdc63`; built on b7a2b65e7, not reverted.
  - [x] Override `"proxy-addr": "^2.0.8"` present in `api/package.json`; proxy-addr 2.0.8 in both locks (carried).
  - [x] Fixed invocation needs `REGISTRY=local` (empty REGISTRY yields `/sentropic-api:...` invalid ref).
- [x] **Lot 1 — jose peer widen + gateway bump**
  - [x] `packages/llm-gateway/package.json`: peer `jose` `^5.10.0` -> `^5.10.0 || ^6.0.0` (optional kept), version `0.19.1` -> `0.19.2`.
  - [x] No in-repo pin updates needed: api `^0.19.0`, cluster-mesh `>=0.19.0 <0.20.0`, apps/llm-gateway `file:` all still satisfied; no `0.19.1` in gateway src/tests; cluster-mesh fixtures/specs pin the PUBLISHED train and must stay.
  - [x] No CHANGELOG entry (patch-ship precedent e5ed090e1: version + lockfile only).
- [x] **Lot 2 — MCP SDK bump + clean lock regen**
  - [x] `api/package.json`: `@modelcontextprotocol/sdk` `^1.29.0` -> `^1.31.0`; proxy-addr override kept.
  - [x] `make lock-root` (node:24-alpine one-off): clean, no ERESOLVE (jose clash gone via workspace link).
  - [x] `npm update @modelcontextprotocol/sdk` (same container pattern): converged the leftover track-pulled 1.30.0 to a single hoisted 1.32.1 (all track versions still declare `^1.30.0`, satisfied by 1.32.1 — verified on registry).
  - [x] Lock confirms: proxy-addr 2.0.8, SDK 1.32.1 (only copy), gateway workspace 0.19.2 + widened peer, no ERESOLVE. Root diff is surgical (SDK 3-line bump + gateway metadata).
- [x] **Lot 3 — Verification gates**
  - [x] Production `npm audit --omit=dev --workspaces --include-workspace-root`: 0 HIGH, 0 CRITICAL; exact audit-gate logic: OK (both GHSA-... gone).
  - [x] Fresh api image build (`make build-api-image`, audit gate in-Dockerfile): SUCCESS.
  - [x] `make test-api-security-sca ENV=test-proxy-addr`: only 1 finding remains (source-map-js HIGH, pre-existing dev-only, own branch — see attention).
  - [x] `make typecheck` exit 0 (with `API_IMAGE_REF=` prefix — see acknowledge).
  - [x] `make lint` exit 0 (0 errors / 207 pre-existing warnings, baseline-identical).
  - [x] `make test-llm-gateway`: 28 files / 389 tests passed. `make test-llm-mesh`: 317 tests passed.
  - [x] `make test-cluster-mesh`: 53 files / 394 tests passed (5 packaging files skipped by design) after updating the 3 workspace-version assertions in `gateway-surface.spec.ts` to 0.19.2 (the suite symlinks the workspace gateway; the old 0.19.1 pins failed).
  - [x] `test-lazy-package` (bare): fails only on unpublished 0.19.2 ETARGET (see attention); committed fixtures untouched.
  - [ ] Final production rebuild + stack smoke (`/api/v1/health`, runtime versions) + `make down ENV=test-proxy-addr` after push (tag/receipt realignment).
- [ ] **Lot 4 — Docs & delivery**
  - [x] `.components/tech-debt-api.md`: no update (proxy-addr / MCP SDK / jose not tracked there).
  - [ ] Two atomic commits via `make commit` (no AI attribution): (1) jose peer + gateway bump, (2) SDK bump + lock; push; update PR #643 (title `fix(deps): proxy-addr 2.0.8 + MCP SDK 1.31.0 + jose peer (GHSA-jqcg-44mw-7w3h, GHSA-6qxp-vccf-f47h)`), English body, no AI trailer.
  - [ ] CI watch on #643; fix branch failures. Stop at open PR (no merge — conductor gets owner GO).
  - [x] `.h2a/build/fix_report.md` written (this session's state).
