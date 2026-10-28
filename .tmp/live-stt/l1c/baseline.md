# L1c integration baseline and L0 reconciliation

Observed 2026-10-26 UTC. Author: codex / gpt-6.1-sol / high. Approved r3 SHA-256:
`5a666faa9e1856245ef94b19988cb08514e6e1aeac32918715c07f8ce4a24c61`.
The final verbatim Q1–Q6 answers remain binding. This branch implements §11 L1c;
it retains every L0 document under [../l0](../l0/baseline.md), from exact source
`c0bd543689e31c6511150b2d26b71947bb85c455`, without changing their historical dates.

## Heads and dependency status

| Input | Refreshed evidence | Consequence |
|---|---|---|
| Fetched origin/main | `fbfe68f0e40d386e6b3429abc2ea8f868fcdd3f6` | Created requested worktree/branch from this base |
| origin/feat/live-stt-l1c | Remote ref absent at fetch and ls-remote | New branch created; no existing head discarded |
| L1 PR #754 | `01d784be8fd2f61073c5d3174c79bff4d47c2aa6`, open draft, user reports Opus r2 approval | Integrated by fast-forward merge; no rebase or copied commits |
| L0 PR #753 | Source `c0bd543689e31c6511150b2d26b71947bb85c455` | Retain eight documents as historical evidence, refresh moving facts here |
| h2a origin/main | ls-remote `40693473a6e38d3230742ba969f18d34dc3cd78c` | Same remote tuple as L0; no new controller acceptance inferred |
| h2a local | `0d6b2eaf5884834ca5a7498477c6efdfba24a3de` | Existing checkout remains untouched |
| faster-whisper local/upstream | `d2ee195a9a093a4e0cc81553beb2f8e6ced9ebb8` / `a202335ef3d1bb5ad116b68ded947d248b7a506b` | Same candidate/provenance gaps as L0; no native install/model fetch |
| npm view, Compose qualification service | cluster `0.22.1`, mesh `0.27.1`, gateway `0.21.0` | Source train prepares cluster `0.23.0`, mesh `0.28.0`, gateway `0.21.1`; publication/adoption remain distinct |

## §11.2 reconciliation and release owners

| Gate(s) | L1c disposition / responsible handoff |
|---|---|
| G-CONFIG | Versioned schema and local projection with independent stages, both modes, five placements, all primary tuples and whisper.cpp fixtures. Deterministic validation is in [validation.md](validation.md); no engine admission follows from a synthetic catalogue. Sol/cluster maintainer owns integration. |
| G-CODEX / G-CLAUDE / G-MUSE | OPEN with L0 source evidence; Sol/h2a source owners supply persistent native control and all-class fences in L5/L14. No native turn used here. |
| G-QUOTA | Study retained; allocation/reservation OPEN and zero admitted. Sol + allocator/custody owner, accountable rhanka. See [capacity-study.md](capacity-study.md). |
| G-NATIVE / G-LICENSE | OPEN; [SDK and installer inventory](../l0/dependencies.md) retains exact candidate versions, integrity/digests, CMake/Koffi/ONNX paths and license gaps. Muse/build-security supplies pinned offline toolchain/install/run proof before L3/L4; no waiver. eSpeak native GPL and WASM distribution need separate clearance. |
| G-APP / G-HOSTED / G-WINDOWS | OPEN runtime/device/resource evidence. All [placement rows](../l0/placements.md) remain required, including web-online, browser-local, companion and hosted worker. Muse/Sol + host/device owners. |
| G-PUBLISH | OPEN; Muse prepares Lp0/Lp1, rhanka's package-release maintainer owns CI/OIDC releases, h2a integrator owns exact consuming locks and clean installed tuple. Checkout integration and packed checks are separate from publication/deployment. |
| G-LEDGER | OPEN speech exit. Existing host budget-admission/route-settlement use durable DB holds and cost ledger; do not create a second ledger. Sol + gateway/ledger owner must qualify speech units, deduplicated adjustments and atomic aggregate $5/UTC-day + $20 campaign limits in L8. Account/resource/budget refs in L1c grant no authority. |
| G-APP-HOST / G-REMOTE / G-DECISION | OPEN per L0; no new accepted W0/W2, M3/M4 or Decision API receipt supplied. Their owning lanes retain exact tuple/schema handoffs; local projection does not close them. |
| G-CLOUD / G-AWS / G-VOXTRAL-SELFHOST | OPEN/unadmitted. Candidate model names are fixtures, not verified API IDs or licensed converted artifacts. Provider/gateway and engine/security owners retain qualification and optional-adapter estimates. |
| G-REVIEW | Spec r3 and user-reported L1 approval do not approve L1c. Independent correctness/security/release review remains required; [review.md](review.md) records selection evidence. |

The SDK inventory includes OpenAI 7.43.0, Google GenAI 2.31.0, Mistral 3.3.0,
Claude Agent SDK 0.3.310, AWS Bedrock 3.1156.0 and sherpa-onnx-node 2.0.0 as
**dated candidate pins**, with original integrity/license evidence in L0. No SDK
is added by L1c. Native binaries, models, voices and FFmpeg build notices retain
their separate provenance/license gates; package metadata is insufficient.

L0-D01 is closed for this lot by its template-derived BRANCH.md and mechanical
scope checks. Other lot plans remain their owners' work. L0-D02 stays OPEN for
Muse/build-security before L3/L4: static installer inventory does not prove a
fully pinned, interpreter-free offline install/build/run path.

Root catalogue/barrel/manifest/lock changes are serialized in this author branch.
Existing Makefile/Compose/CI and Track files remain unchanged. No shared Track
writer/entitlement was supplied, so no import or inference dispatch is inferred.
