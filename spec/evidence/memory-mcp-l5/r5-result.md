# Memory MCP L5 R5 result receipt

**Verdict: NOT QUALIFIED. No L5-MEMORY-V1 acceptance is issued.**

Qualification date: 2026-10-29. Author: Codex, requested `gpt-6.1-sol`, high.
Base: `c37662a208a19ae12377d1a0aec2c7610c4bc0aa` (`origin/main` when the branch was created).
BRR5-EX2 integrates later main `2ea238790fe992cdbb8e0202b1a73a937b6a1793` through merge `be9738ce62dad5e9498723c0d8e7a8f22389ef53`, preserving the R5 plan and pagination correction. [r5-main-merge.json](r5-main-merge.json) records both parents, zero dense combined diff lines, unchanged Track bytes and 370/370 event containment for each parent. No product edits against imported main or Track writes were authored; temporary import scope was removed.
The candidate remains outside E2; no authored package or product lock changes, and no frozen contract or acceptance rule changes. BRR5-EX1 changes only the CI job API page size in the collector and final guard, preserving complete pagination.

## Identity

[r5-delivery.json](r5-delivery.json) records independently measured archive SHA-256/SHA-512, 114 members, producer source, exact peers and observer hashes.
Archive SHA-256: `965c93e326df9866584261061f4e49571cfd74dfe1dc258c0c6894eea121a4e9`.
P3 SHA-256: `1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730`; checked both locally and via `git show c919b638686fb93c8c90a2634d3c004fd25348b3:tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json`.
The external producer candidate manifest binds those exact bytes and source `0db169cba322015e1ee1b1bdcab09fdc02440f37`; it is distinct from the absent L5 candidate manifest.
Exports match packed package.json; listed packed registry asset hashes match; the external publisher receipt hash and tarball binding match.
The abbreviated producer contract digest `sha256:dd0cccbd…` is not treated as a verified full digest.

## Executed gates

All commands used `ENV=test-memory-l5` last and the shared flock `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`.
The pinned image is `node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`, observed Node `24.21.0`, with no SQLite flags.
Official gate commands additionally used `API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725`.
The retained Lot 1 log is [r5-lot1.log.gz](r5-lot1.log.gz); its uncompressed SHA-256 is `7a1d3038feada90ca17314d7d234399b4c97a6078513b9a53407c6602138c049`.

| Command / gate | Result |
| --- | --- |
| `memory-l5-gate LOT=1 ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json` | PASS, make exit 0 |
| Included `memory-l5-runtime` / `memory-l5-verify` | PASS; P3 inventory/archive graph: 30 files, 54 edges |
| Included platform/broker typechecks / `memory-l5-lint` | PASS; source graph: 50 files, 103 edges |
| Included `memory-l5-tooling` | PASS: 104 tests, 12 files |
| Included `memory-l5-test LOT=1` | PASS: platform memory 107, identity 3, wire 4, registry 3, broker 66; total 183 |
| `memory-l5-test LOT=2` and `LOT=3` | FAIL, each make exit 2: only LOT=1 exists |
| `memory-l5-packed` for exports, disabled-install, identity-source-refusal, sdk-discovery-call, restart-lost-response, confirmation-step-up | FAIL, each make exit 2: `tools/memory-mcp-l5/packed is absent (arrives in Lot 4)` |
| `memory-l5-receipt MODE=preflight` | make exit 0, **accepted:false**; checkpoint ENOENT |
| `memory-l5-receipt MODE=checkpoint` | FAIL, make exit 2 / verifier exit 1, **accepted:false**; checkpoint ENOENT |
| Delivered-source disabled-install predicate | FAIL reproduced, make exit 2; retained below, never waived |
| Supplemental current producer probes | PASS; diagnostic only, not catalog proof records |

Both receipt invocations used `CHECKPOINT=spec/evidence/memory-mcp-l5/r5-checkpoint.json` and `ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/candidate-manifest.json`. Neither exists; no substitute checkpoint was fabricated.
`memory-l5-pack` was not used to regenerate P3: its only supported stage is pre-candidate, and rewriting frozen evidence would not create the missing candidate lots.

## Disabled-install finding and classification

[r5-source-gate.json](r5-source-gate.json) reproduces the **unchanged predicate at the delivered source commit** on the real ordinary installation log: `disabled install: native build attempts observed: > node-gyp rebuild`.
The source-script SHA-256 is `316f9d20b782c6c589aab97adf3f88be66b5c0396a728534845737134c61f3ce`.
The exact install log is [r5-disabled-install.log.gz](r5-disabled-install.log.gz), uncompressed SHA-256 `dc319c4e2328f84150ce0f66bd1470b487be47da65b0fa35af7c234b525b5342`.
The matching command belongs to **tree-sitter-lua@2.1.3**, an optional dependency whose configure step fails because the slim image has no native build interpreter. npm still exits 0.
No `better-sqlite3` or `fs-ext` is installed (`npm explain` exit 1: no matching dependencies); the execution observer records zero memory-native build rows or build outputs.
Thus the reproduced failure is an **environment-triggered false attribution in the producer's historical test predicate**, not a demonstrated native compilation defect in this delivered memory package. The original reported SQLite compilation itself is not reproduced.
The source predicate matches any `node-gyp rebuild` line. Producer commits `5a7105eb71d9199d07cd320aacfdc54ef42bb3d5` and `8a6a08767b7b2f2cf4968505a947c80b7a155f09` later refine attribution; these observer changes are not accepted as a waiver of the delivered-source gate.
**The historical gate remains FAIL and blocking under the existing zero-build requirement.** No gate definition was edited here; a genuine observed memory-native build would also block.

The newer observer's positive controls fire for CJS/ESM loading, provider loading, store opening, identity bootstrap and a native-process canary. On the ordinary candidate install, scripts and optional dependencies are enabled: memory-native builds are zero. The separate disabled runtime gives provider/store/identity/native counts **0/0/0/0**.
Enabled probes use the exact P3 peer archives and SDK **1.32.2**, exercising discovery, six tools, lifecycle, input/refusal paths and real in-memory engine receipts. The **1.31.0** floor repeats discovery and all six tools on the ordinary closure. These do not qualify native stores or deployed host bindings.
[r5-diagnostics.jsonl](r5-diagnostics.jsonl) retains every supplemental gate result. Initial attempt 1 exited 2 only because the diagnostic wrapper treated `npm explain`'s no-match exit as a failed gate; its original output is retained in [r5-diagnostics-attempt-1.json.gz](r5-diagnostics-attempt-1.json.gz). The wrapper now records that informational exit; every acceptance predicate is unchanged. Identical probes reran successfully.

## Exact remaining blockers

1. **Delivered-source disabled-install gate:** reproduced FAIL above; no waiver.
2. **P01–P08:** each lacks mandatory catalog files; exact per-proof paths and required cases are retained in [r5-proofs.jsonl](r5-proofs.jsonl). Supplemental producer tests cannot supply these absent proofs.
3. **P05 / P09:** LOT=2 and LOT=3 runners are unsupported. P09's 18 file paths exist, but its required execution/proof bundle is absent. P10's tooling passes locally; it is not a complete checkpoint.
4. **Strict checkpoint:** no candidate manifest, complete closure, per-case Vitest JSON proof bundle or checkpoint. The real receipt verifier rejects the missing checkpoint.
5. **Retained provenance obligations:** unresolved predecessor mappings; absent `tools/memory-mcp-l5/verifier.mjs`; trusted qualification CI provenance, authenticated owner UAT provenance and authenticated L4/platform/broker/transport acceptances. The amended L0 detached authorization remains pending in `p3-owner-authorization.json`; textual authorization is not a detached signature.

The requested environment differs from the catalog's frozen test/e2e environment names; no diagnostic command is relabeled as a catalog proof. Successful branch CI does not establish checkpoint CI provenance.
Owners/acceptance: the L5 harness owner supplies the missing lots/proofs/verifier/checkpoint; the producer supplies any corrected signed candidate disposition; owner/co-owners supply authenticated authorizations. Re-run the unchanged catalog and strict receipt verification against the same bound bytes before issuing acceptance.
Deployed host tenancy/policy bindings, native SQLite/PostgreSQL parity and key cleanup remain **unverified**.

## Cleanup and delivery

CI on first delivery head `d6cc92bc749474914fcaacfceb61be8df26bbc06`: run `40860736080` attempt 1 was cancelled (68 successful jobs; cancellation origin unestablished). Attempt 2 retained successful jobs and passed every test, including all E2E groups, but its collector failed with GitHub HTTP 502 reading current-attempt job pages of 100; the missing capture then failed artifact upload. No CI success is inferred from those partial results.
The same API read succeeds with pages of 30; four pages returned all 99 then-reported jobs with 99 unique IDs. [r5-ci-pagination.json](r5-ci-pagination.json) retains the public endpoint, failed collector job and measured counts. BRR5-EX1 reduces both authenticated capture reads to 30 while retaining `github.paginate`, current-attempt binding, permissions and fail-closed errors. No job or verdict requirement is skipped.
`make test-ci-expected-results ENV=test-memory-l5` passes 24 tests, including retention of 65 jobs beyond a page and fail-closed 403/502/503 checks. `make memory-l5-tooling ENV=test-memory-l5` passes all 104 tests again. Logs are retained as `r5-ci-pagination-tests.log.gz` and `r5-tooling-pagination.log.gz`; final-head CI remains required after this correction.
After the main merge, the same 24 CI tests and 104 tooling tests pass again, and `memory-l5-verify` confirms unchanged P3 with 30 files/54 edges. [r5-post-merge-checks.log.gz](r5-post-merge-checks.log.gz) retains those checks. The candidate hash is absent from the imported E2 tuple inputs; imported product files match main exactly.

`make down ENV=test-memory-l5` completed under the same flock; `make ps ENV=test-memory-l5` showed no services. Diagnostic containers use `--rm`; no development environment was used.
Mechanical branch/scope checks pass. Authored commits contain at most 150 changed lines and no attribution trailers; the main merge carries existing main history with zero dense combined diff lines, rather than new product edits.
The draft PR retains this result and requires completed/success CI on its exact final head. That GitHub run/head is recorded at delivery, without fabricating a signed L5 checkpoint or merging the PR.
