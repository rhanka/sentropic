# Final artifacts 0.2.0 candidate

Status: Sentropic package gates passed; L8d candidate qualification is NO-GO because Radar consumer bindings block execution. Final PR #739 CI is pending.

- Source SHA: `deca5422c219d587c483973f617dd339d90766e9`.
- Product source: `464581fb813b2fbfb6b4691b250162e0dfd942e9` (#750 included); product source and frozen contracts are unchanged by the later release-tooling commits.
- Worktree: `/home/antoinefa/src/sentropic/tmp/worktrees/861-integration`.
- Toolchain image: `node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`.
- Runtime: Node `v24.21.0`, npm `11.19.0`; artifacts/mesh TypeScript `5.4.5`.
- Build commands: `make test-artifacts ENV=test-861-int`, `make test-artifacts-integration ENV=test-861-int`, `make build-cluster-mesh ENV=test-861-int`.
- Pack command: `make -f scripts/ci/immo-861-final.mk pack ENV=test-861-int` (real npm pack and BLOCK manifest guard).
- Every Docker command uses `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock`; each step is followed by locked `make down ENV=test-861-int`.
- Archives are retained alongside this report and in the integration sibling receipt directory; `candidate.json` records the exact tuple and toolchain.

| Archive | SHA-256 |
| --- | --- |
| `sentropic-artifacts-0.2.0.tgz` | `6122ed8d2adea53be6366918f7df83238e8a7bd0596fdd48b0be752497f2ae82` |
| `sentropic-cluster-mesh-0.22.0.tgz` | `d01a2c7669b7e18e1597d2407790bd64a865a6fe258b6bd61f7f6fba4a6452ab` |

Artifacts npm integrity: `sha512-h/loHGv1vEkYnio3awGww9Nu++5qxcTWvN0hQ19zIrfjmSK9EYIpnSBy47zCRdMJXg19U1nyRuGrfqQZRtxv5g==`.

Cluster-mesh npm integrity: `sha512-xy+3lnR6mwu7R8asatuUbXunuVmaAg2BWnEgGVHaI79BGNXZhQ7npvNWRoO5XnWzQZY67i0JxQ0gaQKjsXGVYQ==`.

## Gates

| Gate | Result |
| --- | --- |
| test-artifacts | 440 passed / 35 files |
| test-artifacts-integration | 172 passed / 12 files; real PostgreSQL and MinIO |
| lint-artifacts | passed; zero diagnostics |
| freeze-types | passed |
| mesh artifacts surface | 21 passed / 1 file |
| full mesh packaging / tuple | 97 passed / 15 files; no skips; artifacts tuple 7, tuple skew 15, strict tuple 3, MCP tuple 2, types/bundlers 17 |
| L8d strict full-Radar installation | passed; 764 packages; strict peers |
| L8d packed runtime/declarations | passed; four tools, OAuth resolved, no source links; strict NodeNext |
| L8d normal runner | 19 passed; no failures, skips or TODOs |
| L8d Radar Q1 | 0 passed / 31 failed / 0 skipped |
| L8d Radar Q2 | 0 passed / 31 failed / 0 skipped |
| L8d Radar acceptance | 0 passed / 6 failed / 0 skipped |
| PR #739 final CI | pending |

No publication or main merge was performed.

L8d tuple digest: `4760c9fa8a12ea31ad57a8bf4a00de635a20ecd07bdda19f896919688a91a773`.

Radar source: `dde9f4c85f2ddaef5a394234299a0ab24dfa1343` (complete frozen-profile head, listKeys `8d6aabb0aea835a45d992d4f379c6fe16d57658c` ancestry verified). `fix/artifacts-tests-e3-barrier` was absent from the remote at the start of this run.

Full Radar lock SHA-256: `eab73382093d6b8f04e78ec9240de01e2ae516c4553086b297aec7e51668515d`; minimal packed consumer lock SHA-256: `5a227d2fc516164810b70a655775bfb8d79d551aef36082bbe09b6a90d7dcbe1`.

## Radar qualification and failure classification

Runner source: `2e6cc983a89c5595def5f2bbefc89b4f54490d8c`; it contains the candidate pack source by merge. Gate `ARTIFACTS_PROVIDER_ACCEPTANCE=1` was set in every invocation. No Radar test source was patched. A local `fix/artifacts-tests-e3-barrier` exists but still points to `dde9f4c85`; there was no newer head or remote branch at selection time.

| Required suite | Passed | Failed | Skipped | Classification |
| --- | ---: | ---: | ---: | --- |
| commit probe | 0 | 4 | 0 | radar: legacy composition lacks compiled profile |
| MCP adapter | 0 | 0 | 5 | radar setup blocker; assertions not covered |
| provider acceptance | 0 | 6 | 0 | radar: incorrect public executor entrypoint |
| Q1 finalization authorization | 0 | 31 | 0 | radar: 29 incorrect-entrypoint failures; not covered: 2 H3 quota cases |
| Q2 provider failures | 0 | 31 | 0 | radar: 29 incorrect-entrypoint failures, 2 unsupported injection-seam expectations |
| host commit authorization | 6 | 0 | 0 | assertions pass; shared host command fails |
| host commit failures | 13 | 0 | 0 | assertions pass; shared host command fails |
| host MCP app adapter | 54 | 0 | 0 | assertions pass; shared host command fails |

Required totals: **73 passed / 72 failed / 5 skipped**. Full host workspace: **152 passed / 1 failed**, 14 files. Across all executed tests: **152 passed / 73 failed / 5 skipped**. Of the 73 failures, **71 are Radar-owned and 2 are explicitly not covered**; the five skipped assertions are additionally not covered because of Radar setup. No Sentropic defect is demonstrated by these blocked consumer cases.

- **Radar — incorrect executor entrypoint (64 cases: Q1 29, Q2 29, acceptance 6).** The installed archive exports `createPostgresCommitExecutor` at `@sentropic/artifacts/adapters/postgres-commit`, as used by its packed example. Radar `artifacts-provider-r2.helpers.ts:30,82` requests it from `@sentropic/artifacts/adapters/postgres`. Owner: Radar Q1/Q2 helper maintainer. Acceptance: bind the published candidate entrypoint and rerun the same suites against these exact archives.
- **Radar — E3 seam expectation (2 Q2 cases).** `testing.injectPhaseFault` is not a frozen seam in spec r2; the frozen public testing API supplies the correlated commit barrier. Existing contract analysis classifies this as a Radar stub. Owner: Radar E3/barrier helper maintainer. Acceptance: align the probe with the frozen barrier ABI and retain both non-key cause assertions.
- **Radar — legacy composition (4 commit-probe failures, 1 full-host failure, 5 MCP setup skips).** `packages/artifacts-host/src/composition.ts:54` constructs the app without the required compiled profile/coordinator binding. Owner: Radar H3/H4 consumer composition. Acceptance: migrate composition and execute all five skipped assertions.
- **Not covered — H3 units 5-6 (2 Q1 failures).** Last quota unit and transaction-bound admission accounting deliberately fail with named coverage gaps; no quota qualification is inferred.
- **Not covered — built Radar image smoke.** The pinned runner uses raw Docker build/run, prohibited by the machine lock; a Compose-owned image runner remains required. The receipt gate correctly rejects this omission.
- **Not covered — L8a/L8b/L8c aggregate.** No matching final-tuple shards were delivered. The standalone aggregate gate correctly rejects missing source/tuple identities; historical shards were preserved under `tmp/l8d-before-final-0.2.0`.

Exact per-case attribution, suite source/log hashes and all four archive digests are in `L8d-final-evidence.json` / `L8d-final-tuple.json` alongside this report. Raw logs/results remain in `tmp/worktrees/861-L8d/tmp/l8d/`; raw receipt SHA-256: `dc7961228d04afb7ecf799c54b77dae362561e7cdbc1bc61cffb85d9f0e405b9`.
