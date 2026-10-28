# Live speech L0 baseline

L0 author: codex / gpt-6.1-sol / high. Observed 2026-10-25 UTC. This is a documentation and evidence freeze, with no inference, microphone capture, model download or speech-budget expenditure.

## Binding inputs and output location

| Input at `/home/antoinefa/src/sentropic/` | SHA-256 / authority |
|---|---|
| `.tmp/live-stt/spec-plan.md` | `5a666faa9e1856245ef94b19988cb08514e6e1aeac32918715c07f8ce4a24c61`; r3, §11 L0 only |
| `.tmp/live-stt/owner-questions.fr.md` | `a43cb38c831eb6fe58ea24d06ae98460eb62dc0cf26c4561f3c2bea741681b6a`; final verbatim answers bind |
| `.tmp/live-stt/review-opus-r3.md` | Opus r3 APPROVE is spec approval; runtime/release evidence remains open |
| `.tmp/packets/DOCKER-LOCK.md` | Shared flock for Docker work; existing ENV-scoped compose targets only |

Q1–Q6 are settled: local and cloud, multiple models/providers, cluster-mesh selection, both mic modes, aggregate speech ceiling $5/UTC day and $20 total, dedicated-capacity study, Codex relaunch under controller, eventual full placement matrix. L0 cannot reopen or reduce them. R3 names no L0 document filenames; this directory keeps its deliverables beside the planned study.

Read [gates.md](gates.md), [dependencies.md](dependencies.md), [placements.md](placements.md), [scope-release.md](scope-release.md), [capacity-study.md](capacity-study.md) and [validation.md](validation.md) as one L0 handoff. Later lots must refresh moving evidence before admission.

## Reconciled heads

| Repository/ref | Frozen evidence | Consequence |
|---|---|---|
| Sentropic study checkout | `97fe9f53e8079694e35771227c11544ce8658316` in r3 | Historical; use fetched integration base below |
| Sentropic fetched `origin/main` | `fbfe68f0e40d386e6b3429abc2ea8f868fcdd3f6`, merge [#729](https://github.com/rhanka/sentropic/pull/729) | L0 worktree base; no root work reused or reset |
| h2a local HEAD | `0d6b2eaf5884834ca5a7498477c6efdfba24a3de`, packages 0.91.0 | Dirty checkout, including profile edits; not a current integration baseline |
| h2a live `origin/main` | `40693473a6e38d3230742ba969f18d34dc3cd78c`, runtime 0.98.7 | GitHub compare: diverged, 874 ahead / 3 behind local; never reset/cherry-pick this checkout |
| faster-whisper local HEAD | `d2ee195a9a093a4e0cc81553beb2f8e6ced9ebb8`, clean tracked tree, 1.2.1 | R3 local candidate retained; Linux x86_64 binaries remain unqualified |
| faster-whisper upstream HEAD | `a202335ef3d1bb5ad116b68ded947d248b7a506b`, default branch `typescript` | Main does not exist; package remains 1.2.1; build script byte-identical; compare API returned 404, ancestry unestablished |

Local h2a `runtime/drive/index.ts` is unchanged from its HEAD. At the newer remote SHA, [the same driver](https://github.com/rhanka/h2a/blob/40693473a6e38d3230742ba969f18d34dc3cd78c/packages/h2a/src/runtime/drive/index.ts#L465) still sends one-shot `turn/start` through `codex app-server proxy` and Claude `-p`. A complete non-truncated remote tree also exposes newer Claude NDJSON runner/lifecycle/tool files. That runner accepts an AbortSignal, uses stream-json and rejects client tool requests; this is a reuse candidate, not proof of a persistent voice owner or all-class fence. Inspect it at L14a before implementation; retain the conditional 10–16 h allowance until qualified.

L5 remains conditional 16–22 h: no persistent barge-in controller is demonstrated by the inspected drive seam. L14b remains 5–8 h conditional: a `muse` executable on PATH establishes neither typed interruption nor its model/entitlement. L3b/L17/L17c retain their conditional estimates. Do not charge missing shared infrastructure to the engineering reserve.

## Current source seams and corrections to the study

Paths below resolve in the frozen Sentropic base; these are source observations, not rerun tests.

| Seam | Evidence and bounded conclusion |
|---|---|
| Mesh modalities | `packages/llm-mesh/src/capabilities.ts`: audio input; output remains text/json/tool-call. No speech package/contract is shipped by L0. |
| Gateway wires | `packages/llm-gateway/src/ports/dispatch.ts`: now includes `openai-responses` as well as chat-completions/messages; still no duplex media wire. |
| Durable ledger | `api/src/services/llm-metering/{budget-admission,route-settlement,cost-ledger-sink}.ts` and `api/src/routes/namespaces/gw.ts`: real DB admission and settlement composition now exists. Do not characterize the entire gateway as an in-memory stub. |
| Remaining ledger gap | Admission selects monthly buckets; token pricing/settlement does not establish audio seconds/tokens/characters or atomic speech daily+campaign caps. L8 binds/extends the established ledger, with its owner. |
| Personal passthrough | `packages/llm-gateway/src/personal-passthrough/metering.ts`: recording/no-op sink still exists; it is not financial acceptance. |
| Chat/flow | `api/src/services/flow/postgres-job-queue.ts:122`: cancel marks chat completed, others failed; process-local abort. L18/L18c still owe explicit interruption, worker ACK and successor fences. |
| Cowork | `packages/cowork-desktop/src/runner/cowork-runner.ts`: sequential pending actions; no qualified turn cancellation argument. L19 remains required. |

## Live dependency PR observations

GitHub metadata was read on 2026-10-25. All rows except #729 are open drafts, unmerged; no author-reported test result is treated as acceptance.

| Repository / PR | Head | L0 disposition |
|---|---|---|
| Sentropic #681 | `5991bfc8c459379c871803acf67d71902524ba72` | Seat import not accepted; allocator/custody activation remains external |
| Sentropic #686 | `3673712f69d45acd46e1742b62e60dc5fca4dacf` | Product model prerequisite not inferred deployed |
| Sentropic #693 | `46df280cc398b6d6a63be37a39294312cf75045c` | API title is judge/JEV; obtain the exact V4-L2/Decision API schema/acceptance mapping, not PR-number inference |
| Sentropic #702 | `e044f43d052365ab3fb9af39418b4212bd5b39db` | W0 host acceptance and W2 lease/auth composition unproven |
| Sentropic #677 | `ac020db2c3382fe42356114631c3729ee9d39833` | D2/M3/M4 positive native/effect acceptance unproven |
| h2a #361 | `5eec228b061cadd3ddb6cf7ea9e10ef7faf32e4f` | Native content pipeline remains an integration gate |
| Sentropic #690 | `7ccd427e54e2ca3e205379a7cb8b83c6d56a8f3b` | MCP publication work is not blanket speech release acceptance |

No production pod, secret, provider account or quota console was read. Publication, consuming lock integration, qualification and deployment require distinct receipts. Current registry differences and shared-file ownership are recorded in [scope-release.md](scope-release.md).
