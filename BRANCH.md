# Feature: Artifacts trust and publication hardening

## Objective
- [x] Fix the seven verified artifacts findings for Track `01M5A25DNQ78WRK4618CXBW3HH` and deliver draft PR #708.

## Scope / Guardrails
- [x] Branch `fix/artifacts-hardening`, worktree `tmp/worktrees/artifacts-hardening`, base `origin/main` at `cf0ad8ee4`.
- [x] CI repair: rebase the 14 artifacts commits onto `origin/main` at `7ed41eb39` to qualify the same L5 inputs as the PR merge checkout.
- [x] Second CI repair: rebase onto `origin/main` at `3556df5c6`; GitHub could not create a PR merge checkout while the two P1 files conflicted with the SQLite integration.
- [x] Mechanical `harness check branch`: PASS C1.
- [x] Make only, Docker tools, no Python, ENV=test-artifacts-hardening last; no listening services during unit checks.
- [x] Selective staging, make commit, every commit under 150 changed lines, no attribution.
- [x] Do not merge or publish; preserve root work and shared Track log.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `BRANCH.md`
  - [x] `packages/artifacts/**`
  - [x] `package-lock.json`
  - [x] `packages/cluster-mesh/tests/integrations/artifacts-surface.spec.ts`
  - [x] `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts`
  - [x] `packages/cluster-mesh/tests/packaging/prepare.sh`
  - [x] `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - [x] `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json`
  - [x] `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json.sha256`
  - [x] `tools/memory-mcp-l5/artifacts/history/**`
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
- [x] Exception process: document BRAH-EXn with reason, impact and rollback before sensitive edits.
- [x] BRAH-EX1 (owner CI repair packet): allow only the artifacts consumer version assertion and P1 manifest/history refresh; impact is test/release provenance, with the 44 contracts and archive bytes unchanged; rollback restores the retained P1 and previous assertion.
- [x] BRAH-EX2 (owner second CI repair packet): allow the selected artifacts lock entry, tuple assertions and batched fixture-version reads; impact is packed-consumer verification only, with integrity enforcement and timeouts retained; rollback restores those qualification hunks.

## Feedback Loop
- [x] Delivery of `6ca10d3e6` exposed GitHub `mergeable=false`, `mergeable_state=dirty` and no new run. Mechanical merge-tree against current main identifies only P1 JSON/hash conflicts; rebase resolves those files and retains both superseded manifests.
- [x] Run `39320255479`, job `118292763317`: all 932 unit tests pass; packed lazy qualification rejects selected lock artifacts 0.1.2 against verified candidate 0.1.4 (version, registry URL and SHA-512 mismatch).
- [x] First repaired packed run: sibling integrity and installed tuple pass; 77/78 tests pass, but the offline preparation test takes 5530 ms against 5000 ms under parallel workers. Batch tuple manifest reads instead of spawning Node for every package; retain the timeout and full parallel qualification.
- [x] Run `39279553217`: L5 rejects the artifacts lockfile change (`manifest freeze/lock mismatch`); Cluster Mesh expects artifacts provider `0.1.2`, receives `0.1.4`; `ci-gate` propagates those two failures.
- [x] Preserve the separate durable L5 dependency-fingerprint proposal at `.tmp/l5-p1-lockfile-coupling.md`; do not implement it in this branch.
- [x] Version coordination: open PR #707 reserves artifacts 0.1.3 and widens the optional platform peer to >=0.3.0 <0.5.0; this branch selects the next patch 0.1.4 and retains that widening. Both current mesh >=0.1.0 <0.2.0 and #707's >=0.1.3 <0.2.0 accept 0.1.4.
- [x] Baseline evidence: HTTP `src/http.ts:200` trusts body storageScopeId; `:202,251,520` accept client paramsHash. Service `src/server/service.ts:46` and publication `src/server/publication.ts:197` use global keys.
- [x] Baseline evidence: publication `src/server/publication.ts:138` hashes arbitrary files without path/size validation; content `src/content/handler.ts:92,154` allows HEAD then returns bytes; `:54` errors have only content-type.
- [x] Baseline evidence: `src/mcp.ts:18` imports platform tool-configuration at runtime.
- [x] Resume audit: seven commits and pending MCP split are readable; first build caught the missed needBytes argument in uploads/append; bound it before allocation.
- [x] Publication review repro: Buffer.slice shares caller storage; mutating the caller during intent recording stored [2] under the digest of [1]. Copy through Uint8Array for Buffer and typed arrays; retain both regression cases.
- [x] Resume gates: typecheck and lint passed; publication security passed 20/20 including both byte-snapshot cases. Update the HTTP parity replay test to ignore forged hashes and conflict on changed metadata.
- [x] Packed-proof scope: the compatible root barrel re-exports /mcp and still requires the platform; the platform-absent consumer imports /mcp-core directly. Document the distinction without changing root exports.
- [x] Review boundary: every implementation hunk inspected and regressions qualified; independent consensus is not established because exact resumed-author model/effort metadata is unavailable. Maintainer review remains a pre-merge gate outside draft delivery.
- [x] Document compatibility changes and migration in packages/artifacts/README.md, including host scope, legacy hashes, publication limits/paths and replay-key migration.
- [ ] Designated Track writer imports this source plan; this worktree does not append .track.

## AI Flaky tests
- [x] No waiver or increased timeout; deterministic library checks.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one coder; independent review only when available through the prescribed review surface.

## UAT Management (in orchestration context)
- [x] Library contracts only; no browser application changes or root dev UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and branch**: read rules, inspect findings, verify isolated branch, inspect #707.
- [x] **Lot 1 — Authority and idempotency**
  - [x] Resolve ensure scope from trusted host context and ignore legacy body scope/hash.
  - [x] Namespace service keys by operation and principal; hash validated parameters server-side.
  - [x] Ensure service now scopes keys and derives hashes; three focused repros failed against baseline before the fix.
  - [x] Tests: service.test.ts, http-security.test.ts, HTTP/MCP parity and existing fixtures.
- [x] **Lot 2 — Publication boundaries**
  - [x] Path/hash/principal repros failed in 17 cases against baseline; added service validation and server-derived replay digest.
  - [x] Validate canonical relative paths, duplicates, count, per-file and total bytes before effects; HTTP checks before allocating decoded bytes.
  - [x] Compute publication hash over server-derived file digests and metadata; principal-scoped keys.
  - [x] Tests: publication.test.ts, publication-security.test.ts, HTTP publication regressions; full unit suite 183/183 across 25 files.
- [x] **Lot 3 — Content HTTP semantics**
  - [x] Suppress all HEAD bodies and apply security/cache headers to errors and activation; regression failed on baseline.
  - [x] Tests: content-security.test.ts and content.e2e.test.ts; complete integration/E2E lane passed 30/30 across six files on isolated Postgres/MinIO, then stopped the services.
- [x] **Lot 4 — Platform-free MCP and release**
  - [x] Preserve /mcp compatibility; expose /mcp-core with no runtime platform dependency.
  - [x] Relocate MCP source with public exports preserved, before splitting its platform wrapper in a separate atomic commit.
  - [x] Finish compatible /mcp wrapper; MCP scoped tests passed 11/11 before release-version update; select unpublished 0.1.4 above npm 0.1.2 and retain #707 peer widening.
  - [x] Packed clean-consumer proof with platform absent; package and provider version 0.1.4; optional platform peer >=0.3.0 <0.5.0.
  - [x] Tests: mcp.test.ts, packed consumer, typecheck-artifacts, lint-artifacts, test-artifacts; PACKED_MCP_CORE_OK, PACKED_CONSUMER_OK and PACKED_ADAPTERS_OK.
  - [x] Typecheck, lint and full unit suite passed with the 0.1.4 source and final HTTP parity assertions.
  - [x] Qualification receipt: packages/artifacts/probe/HARDENING_QUALIFICATION.md records commands, 213 passing tests, platform-absent proof and archive SHA-256 values.
- [x] **Lot 5 — Delivery**
  - [x] Review every hunk, scope-check before each commit, push and open draft PR #708 using this plan; inspect GitHub checks on the pushed HEAD.
  - [x] Report draft PR number, HEAD and qualification receipt; preserve the seven original commits, keep every new commit under 150 changed lines, and do not merge or publish.
- [x] **Lot 6 — PR #708 CI repair**
  - [x] Reproduce and update the Cluster Mesh artifacts provider version assertion; focused test 7/7, lint/typecheck and complete unit lane passed (932 tests, 126 conditional skips).
  - [x] Archive P1 `280a2ce12938414a36696fcc45540f6b4d90ac461dd2d586dbaf4492add1b767` and regenerate through `memory-l5-pack`; all 44 contracts and both archive digests remain identical.
  - [x] New P1 SHA-256: `ca14388d51de2be5687561a8b652f18261aa6f09d0e308be55bf43110d12f15b`; lockfile SHA-256 `5b0152f8b4b7135b0778e85bbe2ae18d6752aee4d3c6b0ebd98dfdbd6324c03c`.
  - [x] After rebase, `npm view @sentropic/artifacts version` in Docker confirms published `0.1.2` < candidate `0.1.4`.
  - [x] `memory-l5-gate LOT=1` passed (228 tests); artifacts typecheck/lint and 183 unit tests passed; packed core/consumer/adapter proofs passed with platform 0.3.1 and artifacts 0.1.4.
  - [x] Scope checks passed; deliver the repaired draft branch with a lease on original remote head `2ebe21ef8`, without merging, marking ready or publishing.
- [x] **Lot 7 — Packed Cluster Mesh CI repair**
  - [x] Reproduce the exact same-PR sibling qualification and refresh only the artifacts candidate entry through the Make lock-refresh lane; retain four artifacts metadata changes and discard unrelated refresh churn.
  - [x] Candidate SHA-256 `7755caf83e487f52d0a732beb306a783b8a1da9bb8270bac2e0e731a9567f918` matches the CI archive exactly; the sibling integrity guard passes.
  - [x] Cover source/selected candidate version coherence (regression fails on 0.1.2) and validate the installed platform against both consumer peer ranges (six tuple tests pass).
  - [x] Batch ten tuple version reads in one Node process; the offline preparation check passes in 1202 ms on the focused lane, with the original 5000 ms timeout.
  - [x] Final gates: lint/typecheck and guarded pack pass; 933 unit tests pass (126 conditional skips); full parallel packed lazy qualification passes all 78 tests with verified sibling receipts and unchanged timeouts.
  - [x] Clean candidate install with the exact CI peers and artifacts sibling passes every declared Node entry point; candidate Cluster Mesh SHA-256 `79ac243b77b480d02f8b17467af37b2daa6fd8997f56bdb79f4f4e138ef2da88` matches CI.
  - [x] Delivery constraints: selective staging, scope-check before make commit, push the draft branch; no merge, ready transition or publication.
- [x] **Lot 8 — Qualify the current main merge checkout**
  - [x] Rebase onto `3556df5c6` without merging; retain main P1 `68181613...` and branch P1 `ca14388d...` in history, and recheck npm 0.1.2 < artifacts candidate 0.1.4.
  - [x] Regenerate P1 through memory-l5-pack: `014a1f014c668e3cec6f724fa278073774eb2e4307b086c55bceccbaaa01986a`, lockfile `b4bc5762c8c94c29bc7cfcb43b27c2fa3f0daf80d0a2e9372377fdfa4a9b7ca3`; all 44 contracts and both archive digests/integrities are unchanged; memory-l5-gate LOT=1 passes all 228 tests.
  - [x] Rebased Cluster Mesh 0.20.0: lint/typecheck, 972 unit tests (129 conditional skips), guarded pack, all 78 parallel packed tests and clean candidate installation pass, including the SQLite entry point; artifacts candidate bytes remain `7755caf8...`.
  - [x] Delivery constraints: push with a lease on remote head `6ca10d3e63406a4fc093ec4f4099866607ef3c0d`; retain the draft state and report the new GitHub run separately, without merging or publishing.
