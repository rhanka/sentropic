# L8d complete-integration packed-candidate receipt

Status: **FAILED qualification / NO-GO for the 0.2.0 candidate gate**. Strict installation and packed compilation now pass; consumer acceptance remains blocked.

Original PR #746 was already merged at 238ab2959. Requalification commits are pushed on feat/artifacts-861-L8d; replacement draft [PR #749](https://github.com/rhanka/sentropic/pull/749) targets feat/immo-861-integration. No CI run was listed for the pushed branch when checked.

- Integration: `082fe4c60ccd70d7a89afb63ebed1fc42f5acdd0` (#744/#747/#748), merged without rebase in `895e67f97`.
- Pack/build/normal-tests head: `9de58fe2bb57749d372c431736b7e0f24d99945f`; Radar rerun head: `0c20aac52d54ba722e229c745a9d94086898fa33`. Later commits contain qualification evidence/runner changes only.
- Tuple digest: `ab187a43078758cc3b57bd65cd00190dac795010955774381d471a3295dfacba`.
- Artifacts 0.2.0 SHA-256: `fa8bc96f0e92fd4cd526243286e912b5e79d0aad8081d9d94c85263d4fe4213d`.
- Mesh 0.22.0 SHA-256: `d01a2c7669b7e18e1597d2407790bd64a865a6fe258b6bd61f7f6fba4a6452ab`.
- All four archive SHA-256/SHA-512 SRI values: [tuple-receipt.json](tuple-receipt.json). Platform 0.4.0/auth 0.2.2 use exact registry archives; artifacts/mesh were rebuilt from the merged sources.
- Strict full-Radar lock SHA-256: `16214f9fe69b845b99638c82c1a1456b71364f46b4ed8585b5be8374d6955727`.
- Minimal strict-consumer lock SHA-256: `2f71ea881a1354a6e4b40569c4cf1e60ad702aeff75431352685fa8beea3e703`.
- Node image: `node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`; PostgreSQL matches Radar's `postgis/postgis:16-3.4`; MinIO uses the pinned Compose image.
- Radar: integration `b2b802b57b84dd623588005042ce78ca4eec8fb7`, A1 `f2b6c25cc9458ec285d6d4f620a55dad8c30f909`, A2 `b104ae90a28a5581e8eabd15f12acb58558d3396`, acceptance/helper overlay `e2e9515ea41baebf5539743f0cfa0dea750d072c`; ancestry verified.
- Exact suite source/log hashes, gate values, counts and shard inputs: [radar-receipt.json](radar-receipt.json). Raw receipt `tmp/l8d/receipt.json` SHA-256: `490d90e36e7bbdb4c5cbd7521952a671a58e479ed91c80036f07637461484e8d`.

## Executed gates

- Strict full-Radar lock regeneration and npm ci: **passed**, 764 packages, strict peers, no force/legacy options.
- Minimal archive install + npm ci, packed runtime (four tools, OAuth, zero source links), strict NodeNext public declarations: **passed**.
- Normal lane: **19 passed, 0 failed, 0 skipped, 0 TODO**. Includes the former ERESOLVE/TS2307 regressions and real llm-mesh 0.19.2 runtime admission; both former failures now pass as ordinary tests.
- First API attempt failed before assertions because the generic PG image lacked PostGIS. The scoped runner overlay fixes this; initial evidence remains at `tmp/l8d/pre-postgis/`. No Radar suite was edited.
- Full host workspace: **157 passed / 1 failed / 0 skipped**, 15 files. Required three host files contain 73 passing cases; workspace failure still rejects the host command.

| Required suite | Passed | Failed | Skipped | Observed blocker |
| --- | ---: | ---: | ---: | --- |
| artifacts-commit-probe.spec.ts | 0 | 4 | 0 | Legacy Radar composition omits compiled profile |
| artifacts-mcp-adapter.spec.ts | 0 | 0 | 5 | Same composition fails beforeAll; skips rejected |
| artifacts-provider-acceptance.spec.ts | 0 | 6 | 0 | effectiveProfile diagnostic; separate cleanup hook failure |
| artifacts-finalization-authorization.spec.ts (Q1) | 0 | 31 | 0 | 27 profile diagnostics, 2 purge joints, 2 explicit H3 gaps |
| artifacts-provider-failures.spec.ts (Q2) | 0 | 31 | 0 | 31 effectiveProfile diagnostics |
| commit-authorization.test.ts | 6 | 0 | 0 | Full host command remains failed |
| commit-failures.test.ts | 13 | 0 | 0 | Full host command remains failed |
| mcp-app-adapter.test.ts | 54 | 0 | 0 | Full host command remains failed |

Required totals: **73 passed / 72 failed / 5 skipped**. All six invocations use acceptance gate **1**. Across all invoked Radar tests including the rest of the host workspace: **157 passed / 73 failed / 5 skipped**; additional cleanup/setup hook errors are not assertion counts.

## Distinct failure classes and bounded handoffs

- **[missing-contract] profile wiring:** Q1 27 + Q2 31 + acceptance 6. The pinned helper passes `{selectedCapabilities,effectiveProfile}`; the frozen/public compiler requires `version,selectedCapabilities,operations,contractRevisions` and exposes `profileDigest`, while the helper checks `digest`. This is a demonstrated consumer/provider binding mismatch, not proof that the compiler export is absent. Owner: Radar Q1/Q2 with Sentropic L0/L1 contract handoff. Acceptance: bind the frozen profile without dropping semantic assertions, then rerun these same packed suites.
- **[missing-contract] purge seam:** Q1 2 cases name `testing.pausePurgeBeforeDelete` / deletion-claim inspection. Owner: Sentropic L4 + Radar Q1 binding. Acceptance: supply the specified correlated purge observation binding and execute both serialization-order cases.
- **Explicit H3 limitations:** Q1 2 cases fail as `[not covered]` for last quota unit and admission accounting, owner Radar H3 units 5–6. They remain uncovered; no upstream quota qualification is inferred.
- **Radar test defect, separate from missing-contract:** acceptance afterAll raises `invalid blob prefix` at line 197 from `listKeys("")`. Other empty-prefix calls remain in the pinned acceptance/helper. Owner: Radar branch `fix/artifacts-tests-scoped-listkeys`; acceptance: scoped enumeration/cleanup and rerun. This hook error does not explain away the six profile failures.
- **Legacy composition:** commit-probe 4 failures, MCP beforeAll (5 skips), and host composition.test.ts 1 failure report `invalid compiled artifacts profile`. Owner: Radar H3/H4 composition; migrate required profile/coordinator/invocation wiring, then rerun. The helper's unconditional coordinator/composition placeholder joints are masked by the earlier profile error, not newly observed runtime failures.
- **Image gate not covered:** pinned Radar image-smoke uses raw Docker build/run forbidden by the machine lock. Owner: consumer runner maintainer; provide a Compose-owned image runner with the same packed bytes and image smoke assertions. The final receipt target correctly exits nonzero; a Node-container runtime pass does not qualify a built Radar image.
- **Four-shard aggregate failed:** delivered L8a/b/c receipts have no common packed tuple digest and older source heads; the standalone aggregate target rejects them. Historical source-test evidence is not promoted to this rebuilt tuple, and the now-fixed L4/L3 defects are not reported as new discoveries.

## Reproduction and isolation

Use `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f packages/artifacts/probe/l8d/qualification.mk <target> ENV=test-861-l8d` for `pack`, `install`, `smoke`, `test`, `radar`, `receipts`, `aggregate`; run matching locked `down` after each step. `pin-radar` and `scope-check` are host-only. Every Docker step used the shared lock and matching cleanup; no other environment was changed. Published-byte qualification and activation remain L9 gates.
