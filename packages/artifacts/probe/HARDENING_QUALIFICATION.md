# Artifacts 0.1.4 qualification

- Date: 2026-10-19.
- Qualified source commit: `daf1c49415f8cd5cd5b92e85252fddae45fe30db`.
- Scope: the seven findings in the artifacts-hardening packet, Track `01M5A25DNQ78WRK4618CXBW3HH`.
- Original seven local commits survived the resume; compilation and tests caught and completed the upload decoder call and HTTP replay expectation.

## Local gates

```sh
make typecheck-artifacts lint-artifacts test-artifacts ENV=test-artifacts-hardening
make test-artifacts ENV=test-artifacts-hardening
make test-artifacts-integration API_PORT=9700 UI_PORT=5900 MAILDEV_UI_PORT=1800 ENV=test-artifacts-hardening
make probe-artifacts-packed-consumer ENV=test-artifacts-hardening
make scope-check ENV=test-artifacts-hardening
```

- Typecheck and lint passed. After updating HTTP replay expectations, all 183 unit tests passed across 25 files.
- All 30 integration/E2E tests passed across migration, Postgres, S3, content, pilot-contract and publication suites.
- Security cases cover trusted scope, principal-isolated replay, server-derived hashes, path/count/byte limits, HEAD suppression and error headers.
- A caller-mutation reproduction failed for Buffer before replacing its shared slice with a copied Uint8Array; both Buffer and Uint8Array regression cases now pass.
- Test Postgres/MinIO ran only on the isolated test project without published host ports. Logs inspected; `make down` followed by `make ps` confirmed no remaining services.

## Packed proof

The Make probe packs the real candidate and installs it into consumers without repository mounts or workspace links. Its nested core consumer installs only the artifacts archive with optional peers omitted. It verifies platform imports and `/mcp` fail as absent, then imports `/mcp-core` and runs the 15-tool manifest and ensure/publish/get/list flow. A forged tool storage scope cannot override the host scope. Runtime fetch is trapped before imports.

```text
PACKED_MCP_CORE_OK platform=absent tools=15 manifestDigest=platform-free version=0.1.4 utf8Bytes=32 textValidation=ok corp=same-origin fetchCalls=0
PACKED_CONSUMER_OK tools=15 manifestDigest=d490375b5333083c6aab167b03a1bd251423f642781bfeede583afbefe725d31 version=0.1.4 utf8Bytes=32 textValidation=ok corp=same-origin fetchCalls=0
PACKED_ADAPTERS_OK adapters=2 migrations=2
```

| Archive | SHA-256 |
| --- | --- |
| sentropic-artifacts-0.1.4.tgz | `7755caf83e487f52d0a732beb306a783b8a1da9bb8270bac2e0e731a9567f918` |
| sentropic-mcp-platform-0.3.0.tgz | `37367b44befa14ad0a7e10ccf526743a3d053e81f218c24fb6bfd2ee352ec439` |

Both archives passed the packed-manifest guard. The existing root barrel and `/mcp` retain platform registry exports; consumers without the platform use `/mcp-core` directly. Type declarations still reference platform types.

## Release coordination and review boundary

Registry inspection returned artifacts 0.1.2; #707 reserves 0.1.3. This candidate uses 0.1.4, retains #707's optional platform peer `>=0.3.0 <0.5.0`, and fits both current mesh `>=0.1.0 <0.2.0` and #707's `>=0.1.3 <0.2.0` artifacts ranges. The workspace lock was regenerated through Make. Host migration and deliberate compatibility changes are documented in the package README.

Every implementation hunk was inspected. Independent consensus review is not claimed: exact model/effort metadata for the resumed author is unavailable. No merge or publication is authorized by these local receipts; GitHub CI status is reported separately on the draft PR.

## PR #708 CI repair

- Failed run: `39279553217`, original head `2ebe21ef8f346ec656a6b1ff64eb89b466b076a3`.
- `gh run view --log-failed` returned empty output; the GitHub job-log API provided the failure evidence.
- `memory-l5-qualification` rejected the artifacts lockfile update with `manifest freeze/lock mismatch`.
- `validate-cluster-mesh` expected provider version `0.1.2` in `tests/integrations/artifacts-surface.spec.ts`; the candidate correctly advertises `0.1.4`. Only that assertion changed.
- `ci-gate` propagated those two failed dependencies.
- Rebased all 14 original commits onto `origin/main` at `7ed41eb393396fc6d973b22a4373290d19283f82`; `git range-diff` confirmed identical patches. This brings the L5 tools into the branch before refreshing provenance.
- Qualified P1 source: `6c1dfcdfb7886bdadbf02254679bd9499a9e36fd`.
- Archived the previous manifest and its sidecar under `tools/memory-mcp-l5/artifacts/history/280a2ce12938414a36696fcc45540f6b4d90ac461dd2d586dbaf4492add1b767.json`.
- Regenerated with `make memory-l5-pack STAGE=pre-candidate ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json API_PORT=9690 UI_PORT=5890 MAILDEV_UI_PORT=1790 ENV=test-artifacts-hardening`, following #704 (`3aa8880e3`).
- New P1 SHA-256: `ca14388d51de2be5687561a8b652f18261aa6f09d0e308be55bf43110d12f15b`.
- Root lockfile SHA-256: `5b0152f8b4b7135b0778e85bbe2ae18d6752aee4d3c6b0ebd98dfdbd6324c03c`.
- All 44 contract entries remain identical. Platform archive SHA-256 remains `afebb47aa5e95bf555a097a96cd552d57a288edc52a2a345b846eb77c5976511`; broker remains `78ce7b5017bdd260338cc9d825498e385ae4a12e72af76424ea2cc0b83516e67`. SHA-512 integrity values, frozen spec and L0 identity are unchanged.
- Focused Cluster Mesh reproduction failed before the assertion update and passed 7/7 afterward. `make lint-cluster-mesh typecheck-cluster-mesh test-cluster-mesh ENV=test-artifacts-hardening` passed: 932 tests, 126 conditional skips.
- `make memory-l5-gate LOT=1 ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json API_PORT=9690 UI_PORT=5890 MAILDEV_UI_PORT=1790 ENV=test-artifacts-hardening` passed: packed/source graph checks, platform/broker typechecks and 228 tests.
- Post-rebase registry check through Docker: artifacts candidate `0.1.4` exceeds published `0.1.2`.
- `make typecheck-artifacts lint-artifacts test-artifacts probe-artifacts-packed-consumer ENV=test-artifacts-hardening` passed: 183 unit tests and all three packed-consumer proofs. Artifacts archive SHA-256 is unchanged (`7755caf83e487f52d0a732beb306a783b8a1da9bb8270bac2e0e731a9567f918`); the complete platform 0.3.1 archive is `94f1a9364abc7d0ea9f84464c21253054733e65443cb4899f1b94076025f7728`.
- The separate durable L5 lockfile-coupling proposal remains outside this repair.

## PR #708 packed qualification follow-up

- Exact job log: run `39320255479`, job `118292763317`; all 932 unit tests passed before the packed lazy gate rejected selected artifacts 0.1.2 against the verified 0.1.4 sibling (version, registry URL and SHA-512).
- Refresh only the selected artifacts metadata, add source/selected version coherence coverage and check installed platform compatibility against both declared peer ranges. Batch tuple version reads to avoid a parallel offline-preparation timeout; retain the 5000 ms limit.
- Before main alignment, all 933 unit and 78 packed tests passed, as did lint/typecheck, guarded pack and the clean candidate install with every declared Node entry point. The artifacts archive stayed `7755caf83e487f52d0a732beb306a783b8a1da9bb8270bac2e0e731a9567f918`.
- GitHub could not start a new run while P1 conflicted with current main. Rebase onto `3556df5c6a9cbb6abc83e59f6a49e08b731a6064`; retain main P1 `68181613ff36b601d7f6bb62550294fdcd2c0ad26f2ed25cc1ad2fa633fafd5a` and branch P1 `ca14388d51de2be5687561a8b652f18261aa6f09d0e308be55bf43110d12f15b` in history.
- Fresh P1: `014a1f014c668e3cec6f724fa278073774eb2e4307b086c55bceccbaaa01986a`; source head `a8da8b1eafea112bd6875615bb09548b0384ca1a`; root lockfile `b4bc5762c8c94c29bc7cfcb43b27c2fa3f0daf80d0a2e9372377fdfa4a9b7ca3`.
- All 44 contracts and both MCP archive SHA-256/SHA-512 values remain identical. `memory-l5-gate LOT=1` passes all 228 tests on this P1, including packed/source graph checks and platform/broker typechecks. Post-rebase npm inspection confirms published artifacts 0.1.2 < candidate 0.1.4.
- Rebased Cluster Mesh 0.20.0 passes lint/typecheck, 972 unit tests (129 conditional skips), the guarded pack, all 78 parallel packed tests and clean candidate installation with the exact CI peers and the verified artifacts sibling. Every declared Node entry point imports, including storage/sqlite. Cluster Mesh archive SHA-256: `17cc762d41222c4e7f78b487fa94637a693efb63dae45fcd024db9bbaa77ff3b`.

## PR #708 Astra round-1 corrections

- Review: `/home/antoinefa/src/sentropic/.h2a/reviews/pr708_astra_r1.md`, reviewed head `566a4d76f68240311ef8764e4f091b0af32f2b02`.
- Merged `origin/main` at `da3063068` without conflicts in `14d1c1a5f`; no root lockfile or Track changes. Upstream-only scope advisories are documented as BRAH-EX3; authored changes pass mechanical scope checks.
- Qualified source and README: `de877b4f2` (the three fix commits are `7e78f6d80`, `53b4e3acc`, `7384d2ad6`).
- P2 source replay: hash validated provenance, including absence and recipe order, alongside the manifest digest. Persist source within the idempotent publication operation. HTTP/MCP regressions fail before the fix and pass afterward: changed/omitted source returns 409, original provenance survives, and unchanged replay performs no extra source write.
- P2 staged bytes: cap caller maxSize by trusted host/publication ceilings and check sequential remaining capacity before decoding or staging writes. Multi-chunk and caller-override regressions fail before the fix and pass afterward, including exact-boundary commits and an unread excess byte array.
- P2 rejected upload commit: preflight file/path/size/MIME validation before consuming the upload. Four invalid path/MIME cases fail before the fix and pass afterward: no visible release, staged bytes preserved, corrected commit succeeds and then discards staging.
- `make typecheck-artifacts lint-artifacts test-artifacts ENV=test-artifacts-hardening` passes: **192 tests across 25 files**, including nine added regression cases.
- Scoped reruns reuse the already built dependencies with `make -o build-artifacts test-artifacts SCOPE=uploads ENV=test-artifacts-hardening`; both upload suites pass **16/16**.
- `make -o build-artifacts -o build-mcp-platform probe-artifacts-packed-consumer ENV=test-artifacts-hardening` passes all three proofs: `PACKED_MCP_CORE_OK`, `PACKED_CONSUMER_OK`, `PACKED_ADAPTERS_OK`. The reused builds come from the complete gate above.
- Artifacts archive SHA-256: `ebda6bf427d8e303d621c46ebfea67532c941bae4a01e89b0306eaef3809a609`; complete platform archive remains `94f1a9364abc7d0ea9f84464c21253054733e65443cb4899f1b94076025f7728`.
- Same-PR sibling packaging uses a local manifest context reconstructed from the exact `origin/main...HEAD` package paths; the guarded sibling plan selects only artifacts and reproduces the same archive SHA-256.
- `make memory-l5-verify ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json ENV=test-artifacts-hardening` passes. P1 remains `014a1f014c668e3cec6f724fa278073774eb2e4307b086c55bceccbaaa01986a`; root lockfile remains `b4bc5762c8c94c29bc7cfcb43b27c2fa3f0daf80d0a2e9372377fdfa4a9b7ca3`, so regeneration is unnecessary.
- Regenerated the selected fixture through `make -f packages/cluster-mesh/packaging.mk refresh-lazy-package-lock SIBLING_ARCHIVES_FILE=tmp/ci-manifest-guard/siblings/cluster-mesh/receipts.json ENV=test-artifacts-hardening`; retained only artifacts' changed SHA-512 integrity. Package versions and registry URLs are unchanged.
- `make -f packages/cluster-mesh/packaging.mk -o build-cluster-mesh -o build-mcp-platform -o build-artifacts test-lazy-package SIBLING_ARCHIVES_FILE=tmp/ci-manifest-guard/siblings/cluster-mesh/receipts.json ENV=test-artifacts-hardening` passes **78/78 tests across 15 files**, including the verified sibling lock guard and offline artifacts preparation (1320 ms, original 5000 ms timeout).
- This round revalidates the unchanged retained L5 closure; it does not claim a fresh run of all 228 L5 tests or database integration tests. GitHub CI is reported separately after pushing. No PR merge, ready transition or publication.

## PR #708 Astra round-2 upload snapshot correction

- Date: 2026-10-20. Review: `.h2a/reviews/pr708_astra_r2.md`, reviewed head `891e3d86e38857995d99bfc6ca75a9f12f883274`. Qualified source: `e165cf37e` (fix `8ac1ae349`).
- Finding: HTTP preflight retained the first staging read while upload commit verified a second read. A concurrent append could make a two-byte verified request publish a one-byte release.
- Reproduction: `make -o build-artifacts test-artifacts SCOPE=tests/http-uploads-templates.test.ts ENV=test-artifacts-hardening` fails on the reviewed source: declared `hi` (`8f434346...`, size 2), published `h` (`aaa94026...`, size 1). Explicit staging-read barriers reproduce the interleaving without sleeps or timeout changes.
- Fix: serialize append and commit per session; commit copies staging once, validates publication metadata against that snapshot, verifies its digest/size and supplies those same bytes to publication. Concurrent operations return HTTP 409. Failed metadata/digest/size verification releases the lock without consuming the session.
- Regression coverage: HTTP barriers cover successful and rejected concurrent finalization, exact manifest digest/size, no release on failure and corrected retry. A staging-write barrier covers an already-running append, rejection of concurrent commit/append and successful finalization after the write. The four round-1 metadata retry cases remain covered.
- `make -o build-artifacts test-artifacts SCOPE=uploads ENV=test-artifacts-hardening` passed the initial 18 upload cases. `make typecheck-artifacts lint-artifacts test-artifacts ENV=test-artifacts-hardening` then passed typecheck, lint and all **195 unit tests across 25 files**, including the additional reverse-interleaving case.
- `make -o build-artifacts -o build-mcp-platform probe-artifacts-packed-consumer ENV=test-artifacts-hardening` passes `PACKED_MCP_CORE_OK`, `PACKED_CONSUMER_OK` and `PACKED_ADAPTERS_OK`. Artifacts archive SHA-256: `9ea9ebb2ac3ca32496e9ddcc6a74d8a78976585d2d767a23180f395ac7c95618`; Platform archive remains `94f1a9364abc7d0ea9f84464c21253054733e65443cb4899f1b94076025f7728`.
- The existing `publishable-sibling-plan`, `pack-artifacts` and `publishable-sibling-collect` Make targets, with the exact branch package-path context and BLOCK severity, select only artifacts and reproduce the identical archive at qualified source `e165cf37e7bdf73b852461c80450a76c6c99e550`.
- `make -f packages/cluster-mesh/packaging.mk refresh-lazy-package-lock MAKE="make -o build-cluster-mesh" SIBLING_ARCHIVES_FILE=tmp/ci-manifest-guard/siblings/cluster-mesh/receipts.json ENV=test-artifacts-hardening` passes with the existing unchanged Cluster Mesh build. Retain only artifacts' generated SHA-512 integrity; an exact JSON comparison confirms every other fixture field is unchanged. Root lockfile and retained L5 provenance are untouched. Full packed Cluster Mesh, L5 and database integration tests are left to the exact-head CI run.
- GitHub CI is checked separately after the final push, on that exact head. The PR stays draft; no merge or publication is authorized.
