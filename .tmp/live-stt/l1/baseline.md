# L1 entry evidence and L0 handoff

Observed 2026-10-25 UTC. Author: codex / gpt-6.1-sol / high. Scope: approved r3 §11 L1 only; deterministic contracts, no provider/native qualification or expenditure.

## Reconciled inputs

| Input | Exact identity / disposition |
| --- | --- |
| Approved spec | SHA-256 `5a666faa9e1856245ef94b19988cb08514e6e1aeac32918715c07f8ce4a24c61`, rechecked locally |
| Verbatim owner answers | SHA-256 `a43cb38c831eb6fe58ea24d06ae98460eb62dc0cf26c4561f3c2bea741681b6a`, rechecked locally |
| Opus r3 APPROVE | Spec approval only; source/release acceptance remains open |
| Fetched Sentropic origin/main | `fbfe68f0e40d386e6b3429abc2ea8f868fcdd3f6`; worktree created from this ref |
| L0 [PR #753](https://github.com/rhanka/sentropic/pull/753) | OPEN, unmerged; evidence head `008d66b5fd6ff04d1c44f69cf52892c4c3587980` read before implementation |
| h2a remote main | `40693473a6e38d3230742ba969f18d34dc3cd78c`, refreshed via ls-remote; matches L0 |
| faster-whisper remote HEAD | `a202335ef3d1bb5ad116b68ded947d248b7a506b`, refreshed via ls-remote; matches L0 |
| Mesh registry latest | `0.27.1` before bump; prepare minor `0.28.0`, no publication |
| Compatibility tuple refresh | Cluster `0.22.1` and gateway `0.21.0` published at L1 read; prepare `0.22.2` / `0.21.1` under BRLIVE-L1-EX1 to admit mesh 0.28 without duplicate instances |

L0's complete deliverables remain at the planned study location `.tmp/live-stt/l0/` in its PR. Pin their source rather than duplicate or silently revise that concern on L1:

- [baseline.md](https://github.com/rhanka/sentropic/blob/008d66b5fd6ff04d1c44f69cf52892c4c3587980/.tmp/live-stt/l0/baseline.md): reconciled repositories and moving dependency PRs.
- [gates.md](https://github.com/rhanka/sentropic/blob/008d66b5fd6ff04d1c44f69cf52892c4c3587980/.tmp/live-stt/l0/gates.md): all 19 §11.2 and review gates, accountable owners and exits.
- [dependencies.md](https://github.com/rhanka/sentropic/blob/008d66b5fd6ff04d1c44f69cf52892c4c3587980/.tmp/live-stt/l0/dependencies.md): exact SDK versions/integrities, native toolchain/provenance and license inventory.
- [placements.md](https://github.com/rhanka/sentropic/blob/008d66b5fd6ff04d1c44f69cf52892c4c3587980/.tmp/live-stt/l0/placements.md): endpoint, browser-local, cloud, companion, cluster-hosted and remote attachment; primary tuples A–E plus second local engine.
- [scope-release.md](https://github.com/rhanka/sentropic/blob/008d66b5fd6ff04d1c44f69cf52892c4c3587980/.tmp/live-stt/l0/scope-release.md): ledger, shared-file integrator, release owners and consumer locks.
- [capacity-study.md](https://github.com/rhanka/sentropic/blob/008d66b5fd6ff04d1c44f69cf52892c4c3587980/.tmp/live-stt/l0/capacity-study.md): dedicated interactive capacity study required by owner Q4.
- [validation.md](https://github.com/rhanka/sentropic/blob/008d66b5fd6ff04d1c44f69cf52892c4c3587980/.tmp/live-stt/l0/validation.md) and [review.md](https://github.com/rhanka/sentropic/blob/008d66b5fd6ff04d1c44f69cf52892c4c3587980/.tmp/live-stt/l0/review.md): author checks and independent-review selection failure.

## Dependency, ledger and release disposition

SDK candidates remain uninstalled: OpenAI 7.43.0, Google GenAI 2.31.0, Mistral 3.3.0, AWS Bedrock runtime 3.1156.0 and sherpa-onnx-node 2.0.0 (Apache-2.0 metadata); Claude agent SDK 0.3.310 requires its own license review. Mesh stays dependency-free. faster-whisper-ts 1.2.1 is MIT; its CTranslate2/Koffi/ONNX/FFmpeg/Silero/model artifact chain remains unqualified. eSpeak NG GPL native and embedded WASM distribution need separate clearance. No model or toolchain artifact is admitted by this contract.

L8 reuses the existing durable host budget-admission/route-settlement ledger; audio units and atomic aggregate UTC-day/campaign holds remain open. The personal recording sink cannot close G-LEDGER. Sol owns shared mesh/gateway/config catalogue/barrel/manifest integration; Muse prepares Lp0/Lp1 artifacts, and rhanka's protected CI/OIDC release lane owns publication. h2a's integrator owns its exact consuming lock. Publication, consumer integration, runtime qualification and deployment remain separate receipts.

The placement contract preserves five engine placements; remote attachment is a target/control topology independent of engine placement. Provider/model IDs are extensible strings, not additions to the text model router. Every model/adapter/artifact/placement revision has independent capability evidence. No M1 candidate is advertised as qualified by L1.

## Dedicated interactive capacity outcome carried from L0

Q4's study is complete; admission is **zero units**, no dated reservation or entitlement evidence. Preferred conditional path: a named interactive class in the existing allocator, preserving shared account-family counters and protected enrollment/maintenance shares. A second alias/seat is not new entitlement. No account, paid backend or quota override is created.

M1 ceiling is 1,025 counted native turns, including resumes, across five primary tuples and adjunct checks. Current policy maxima before competing use are 2/day normal or 8/day native-campaign: at least 513 or 129 quota-only days. Dedicated separately entitled capacity has no supplied quote, terms, limits or authorization; actual completion is unscheduled. Existing authoring capacity is not a qualification reservation.

The $5/UTC-day and $20 aggregate speech ceiling excludes agent turns. This session spends $0 and reserves $0. G-QUOTA/G-CLOUD/G-LEDGER must close before paid/native campaigns; no admission is inferred from this draft.

## §11.2 gate reconciliation

| Gates | L1 disposition and next owner |
| --- | --- |
| G-CONFIG | Open; Sol + cluster-mesh owner, L1c schema/projection before adapters/clients |
| G-CODEX / G-CLAUDE / G-MUSE | Open; respective h2a source/runtime owners + Sol, persistent controller and every-class fence evidence |
| G-QUOTA | Open admission; allocator/custody owner + Sol, entitlement/fresh quota/dated reservations |
| G-NATIVE / G-LICENSE | Open; build/security/license owners + Muse, per-artifact clean interpreter-free install/run and distribution receipts |
| G-APP / G-HOSTED / G-WINDOWS | Open; host/resource/device owners + Sol/Muse, full placement/OS evidence |
| G-PUBLISH | Open; release owner + Muse/h2a integrator, immutable package and consumer-lock receipts |
| G-LEDGER / G-CLOUD | Open; gateway/ledger/provider owners + Sol, atomic speech caps and per-model schema/price/terms/entitlement |
| G-APP-HOST / G-REMOTE / G-DECISION | Open; app-switch/Remote Control/Decision API owners, accepted source/auth/effect/approval tuples |
| G-AWS / G-VOXTRAL-SELFHOST | Unadmitted optional engines; provider/engine/security owners, separate exact tuple and estimate |
| G-REVIEW | Spec approved; independent L0/L1 implementation/security acceptance remains open |

The bounded design entry is justified by §11.2's explicit contract/fixture continuation. L1 does not close runtime, spending, release or full M1 acceptance gates.
