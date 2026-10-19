# Feature: Cluster-mesh stateful MCP wrapping

## Objective
- [x] Implement approved #706 blockers 1–3, qualify the twelve Immo tools, and deliver draft PR #707.

## Scope / Guardrails
- [x] Base: spec HEAD `8ac9c7c64381c98b1a52d81d6ede8bce2b46ecc7` after rebase; initial creation at `f560d073b9c0d04fd5947e018a7abb2632e302ed`; branch `feat/cluster-mesh-mcp-stateful-wrap`.
- [x] Worktree `tmp/worktrees/cm-mcp-stateful-wrap-impl`; ENV=test-cm-mcp-wrap; no listening ports or root dev changes.
- [x] Make only, ENV last, no Python, sequential Docker builds, selective staging, make commit, under 150 changed lines per commit.
- [x] Preserve host identity, sessions and ownership; prohibit bearer passthrough, exchange installation and legacy fallback.
- [x] Do not merge or publish; retain BRANCH.md at draft delivery.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `BRANCH.md`
  - [x] `packages/mcp-platform/**`
  - [x] `packages/cluster-mesh/**`
  - [x] `packages/artifacts/package.json` (BRWRAP-EX2)
  - [x] `scripts/ci/publishable-ci-wiring.test.mjs` (BRWRAP-EX2)
  - [x] `package-lock.json`
  - [x] `.github/workflows/ci.yml` (BRWRAP-EX1)
  - [x] `tools/memory-mcp-l5/artifacts/**` (BR707-EX3)
  - [x] `packages/mcp-broker/package.json` (BR707-EX4)
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `.cursor/rules/**`
  - [x] `.track/**`
  - [x] `api/**`
  - [x] `ui/**`
  - [x] `plan/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] `.github/workflows/**`
- [x] Exception process: record BRWRAP-EXn with reason, impact and rollback before changing sensitive paths.

## Feedback Loop
- [x] Resume gates: mesh typecheck/lint and 987 tests; platform 345 tests and strict API extraction; full memory-l5-gate with regenerated P1; 15 installed core tests plus the 27-tool variant; 77 packaging tests; 34 clean-consumer import checks; 86 manifest-guard and 18 qualifier tests. All passed with ENV=test-cm-mcp-wrap. The isolated preparation test passed in 2.16s without a timeout change.
- [x] Packaging resume: invalidate the selected lock's cached mesh entry before Make regeneration so the rebuilt same-version archive supplies its current dependency maps. The first refreshed lock only updated platform integrity and retained the old optional-peer metadata.
- [x] Packaging worker isolation: 76/77 tests passed, but the offline preparation test exceeded its existing 5s budget amid concurrent child-process probes (5.3s); the same test passed in the serial cold lane. Run the installed packaging suite with one worker, matching the cold lane, and retain every existing timeout.
- [x] Regenerated P1 with the existing memory-l5-pack target: two archives, 44 contracts, manifest SHA-256 732b96bc3284fb6f38cf031bd33a9cfe341ee7bc8129741f7e9726a371b66d53. Strict packed verification and both public API extractors pass; previous proof remains in immutable history.
- [x] Preserve main's P1 manifest and SHA-256 sidecar under immutable history identity 68181613ff36b601d7f6bb62550294fdcd2c0ad26f2ed25cc1ad2fa633fafd5a before replacing the active proof.
- [x] BR707-EX4 / blocking P1 closure repair: the existing packer refuses broker ^0.3.1 with platform 0.4.0 (`P1 dependency closure mismatch`). Align the private broker dependency to ^0.4.0 and regenerate the root lock, preserving source and the strict P1 verifier. Impact: the merged memory consumer resolves the same platform candidate; rollback both manifest and lock together. Verify with the existing memory-l5 gate.
- [x] BR707-EX3 / owner resume packet: regenerate retained P1 artifacts after the merged lock changes. Evidence: memory-l5-verify fails with `manifest freeze/lock mismatch`. Impact: archives and immutable manifest history only; keep the memory toolchain unchanged. Rollback: revert the generated proof together with its lockfile input.
- [x] Main integration: preserve SQLite #704 and memory #700; retain mesh 0.21.0, platform 0.4.0, artifacts 0.1.3 and the version-bound configuration digests. The merge imports main-owned files unchanged; conflict resolutions remain in the declared package/lock scope.
- [x] Owner input (2026-10-19): embed mcp-platform as a regular mesh dependency, preserving one npm-resolved kernel without bundling duplicate code. Immo installs `@sentropic/cluster-mesh@0.21.0` plus optional `@sentropic/artifacts@0.1.3`; platform 0.4.0 resolves transitively. Host entries: `@sentropic/cluster-mesh/compose/mcp-stateful`, `@sentropic/cluster-mesh/mcp/registry`, `@sentropic/cluster-mesh/mcp/artifacts`; artifacts definition and executor both come through mesh.
- [x] Embedded-platform installed proof: mesh alone resolves platform 0.4.0 transitively; public types, refusal probes and 15 core tests pass. Adding only artifacts 0.1.3 passes the 27-tool test through mesh exports. CI wiring passes 22 tests; root lock was regenerated in 9063a2597.
- [x] Resume integration: merged origin/main 3556df5c6, resolved the release tuple and P1 provenance, and passed the mesh, platform, memory and installed-consumer gates. Delivery keeps draft #707; push and exact-head CI inspection follow local packaging qualification.
- [x] Latest implementation checkpoint: BRANCH.md.
- [x] BRWRAP-EX2 / Astra R1 release repair: authorize the artifacts manifest patch and CI wiring contract tests. Reason: artifacts 0.1.2 excludes platform 0.4.0, breaking canonical root installation and complete release qualification. Impact: artifacts 0.1.3 widens its platform peer to >=0.3.0 <0.5.0; retain platform 0.4.0 and mesh 0.21.0 for the new wire/wrap API. Rollback: revert the tuple, regenerated lock and matching workflow/tests together.
- [x] R1 implementation: regenerate the root lock without peer bypasses; restore artifacts in candidate, post-publication and bootstrap tuples; require its publisher before mesh; pass canonical platform, complete packaging, 27-tool artifacts and twelve-tool core qualification. Exact-head CI, including installed comments, remains the delivery gate.
- [x] PR #707 now targets main; verified the branch mechanically and pulled GitHub's main merge with --ff-only before the R1 repair. No history rewrite or publication.
- [x] Qualification receipt: `packages/cluster-mesh/tests/conformance/STATEFUL_WRAP_QUALIFICATION.md`; core C8 passed again on the final package bytes, with archive SHA-256 and observed raw RPC maximum 158 bytes recorded.
- [x] Measured agent wall-clock start: 2026-10-19 03:57:48 UTC; final elapsed time is reported with draft delivery.
- [x] Rebase retained every package, lock and workflow byte; published versions rechecked at 0.3.0 / 0.19.1, below the selected 0.4.0 / 0.21.0.
- [x] Exact golden JSON files include a trailing blank line in Radar; whitespace checks exclude only these two pinned files to preserve their original bytes.
- [ ] Final review round is incomplete: the security leg declared xhigh instead of the requested high; its verdict is rejected under the review metadata contract. First-round peers completed without blockers; the final conformance leg completed without blockers. No final consensus or merge clearance is claimed.
- [x] R1 root installation: artifacts 0.1.3 accepts platform >=0.3.0 <0.5.0; `make lock-root` regenerated the root lock without peer bypasses. Canonical platform typecheck, all 237 tests and API extraction passed; the CI wiring suite passed 22/22. Complete installed qualification remains pending below.
- [x] R1 bare-install reproduction: npm considered published artifacts 0.1.2 through mesh's old optional range and failed ERESOLVE even without selecting artifacts. Raise the mesh manifest/catalog floor to 0.1.3 so every selected artifacts version supports platform 0.4; retain optional loading and refusal behavior.
- [x] R1 frozen release fixture: refresh from the existing lock, retain its S3/pg adapter versions, align the selected workspace tuple and verify the platform/artifacts archive integrities. Complete installed packaging matrix passed 77 tests; the subsequent refresh preserves optional adapter coverage.
- [x] R1 installed 27-tool proof: the core consumer first passed all 15 C1–C7 tests without artifacts; installing the artifacts 0.1.3 archive then passed the combined twelve Immo plus fifteen artifacts test, retaining the warm session and verified actor and refusing denied account access before invocation.
- [x] R1 artifact surface expectation: replace the old real-candidate incompatibility assertion with positive loading of all fifteen capabilities; the absent-peer atomic refusal and version-range checks remain exercised.
- [x] BRWRAP-EX1 / CI tuple alignment: candidate, post-publication and bootstrap qualification retain platform 0.4.0 and restore artifacts 0.1.3; mesh publication waits strictly for the artifacts publisher. Impact: complete optional surface remains gated; explicit core qualification is retained. Rollback: revert the workflow hunk with the package tuple.
- [x] L1: finite JSON budgets and cloned advertised-default traversal extracted from the #689 pattern.
- [x] Fixture import progress: 853/853 exact lines pinned from Radar #866.
- [x] Radar constraints read: blocker 6 belongs inside 2b-MCP after #706 and #689; exclude #865 before cutover.
- [x] L5 is Radar-owned and gated on published packages/environment receipts/owner GO; this branch qualifies library contracts only.
- [ ] Designated Track writer imports this source plan; this worktree never appends to shared .track.

## AI Flaky tests
- [x] No waiver or added timeout; deterministic package tests.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one builder; read-only independent review before delivery.

## UAT Management (in orchestration context)
- [x] Package transport qualification only; hosted Radar UAT belongs to L5 on the qualified installed tuple.

## Plan / Todo (lot-based)
- [x] **L0 — Pin baseline and inventory**: exact fixture/receipt bytes, hash, twelve calls, HTTP budgets, defaults, auth/expiry rules, public bind seam.
- [x] **L1 — Tool schema validator**: SDK draft-07 compilation/defaults and independent finite JSON budgets; configuration compiler unchanged.
  - [x] Tests: platform `tests/mcp-wire-schema.test.ts`, existing `tests/registry-parameters.test.ts`; positive, negative, defaults, mutation and remote-ref vectors.
- [x] **L2 — Shared native wire dispatch**: complete SDK discovery/results, safe failures/protocol errors, digest-bound registry inputSchema, explicit AppToolResult mode.
  - [x] Tests: platform `tests/mcp-wire-results.test.ts`, `tests/wire-parity.test.ts`, `tests/stdio.test.ts`, `tests/registry.test.ts`; full platform suite after main integration: 345 passed.
- [x] **L3 — Stateful composer**: host bind contract, immutable request authority/cancellation, policy/account checks, lazy loaders, preflight, one cached router.
  - [x] Tests: mesh `tests/mcp-stateful-{wrap,lifetime,authority,boundaries}.spec.ts`, `tests/conformance/immo-stateful-wrap.spec.ts`; C1–C7, warm bind and failure barrier. Full mesh suite after main integration: 987 passed, 129 infrastructure/packaging tests retain their environment gates.
- [x] **L4 — Package qualification**: versions above npm, exports/ranges/locks, API report, READMEs and installed clean consumer C8; R1 additionally restores compatible artifacts 0.1.3 and the complete installed matrix.
  - [x] Installed core: `tests/packaging/stateful-consumer.sh`, 15 tests plus public TypeScript and missing/version/export/member refusal probes passed; no workspace symlinks or artifacts dependency.
  - [x] Typecheck and lint passed in the cold Docker lanes; published version floors rechecked after rebase. No package was published.
  - [x] Full-root installation, canonical platform API extraction and the compatible installed release matrix passed locally; exact-head CI is checked after pushing. Publication and L5 cutover remain outside this delivery.
- [x] **Final validation and draft PR**: scope-check before each commit; review outcomes recorded; every R1 commit stays under 150 changed lines; retain draft #707, update its body from this plan and inspect checks at the pushed HEAD. Final-review clearance remains outside this repair; no merge/publication.
