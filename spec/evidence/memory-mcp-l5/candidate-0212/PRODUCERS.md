# Missing-proof producer audit (attempt 2)

Inspected origin/main `7815a2a8569f44f220fd4daa5e41dae992618e30`.
The candidate SHA-256 is
`a295eef8a1733fd8c00f72ccd6938a5ea11678fdf33848f8849c4d531bd43af8`.
P2 remains `2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`.

## What the official steps actually produce

| Official target / implementation | Producer or consumer |
| --- | --- |
| `memory-l5-toolchain-snapshot` | Generates pinned toolchain package/lock snapshots; no test sources or proof results. |
| `memory-l5-pack STAGE=pre-candidate` / `pack.mjs` | Builds/packs platform and broker memory contracts, a lock snapshot, a pre-candidate manifest and its SHA-256 sidecar. Rejects every other stage. Does not consume the engram candidate. |
| `memory-l5-verify` / `precandidate.mjs` | Reads and verifies retained P2, its exact two archives, closure, inventory and fingerprints. Generates no missing source files. |
| `memory-l5-test LOT=1` | Runs existing platform memory, identity, wire-parity, registry-dispatch and broker tests. Does not consume `ARTIFACT_MANIFEST`, install engram, or generate missing suites. |
| `memory-l5-test LOT=2` / `LOT=3` | Catalog commands for P05 / P09; both rejected by the Makefile's `LOT=1` guard. |
| `memory-l5-packed` | Catalog installed-consumer runner; refuses execution because `tools/memory-mcp-l5/packed` is absent, explicitly scheduled for Lot 4. |
| `memory-l5-tooling` | Runs existing tooling contract tests (P10). Its receipt-contract test synthesizes fixtures in a temporary directory; these are not candidate proofs. |
| `memory-l5-receipt` / `receipt.mjs` | Reads an existing checkpoint and verifies it. Preflight always reports `accepted:false`; checkpoint fails on outstanding obligations. Does not generate a receipt or suites. The Makefile schedules checkpoint input for Lot 5+. |
| `memory-l5-gate LOT=1` | Verifies the supplied pre-candidate, typechecks, lints, runs tooling and Lot 1 tests. CI uses P2. No implemented candidate-qualification lot exists. |

Repacking P2 would create a new pre-candidate identity, not supply the missing
proof sources. P2 and the candidate were left unchanged.

## Catalog requirements and missing inputs

The complete file lists and exact commands are in `proof-availability.jsonl`.
These are missing **test source files**, not output files created by running
the packer, receipt verifier or proof catalog.

| Proof | Missing sources / producing lot or predecessor |
| --- | --- |
| P01 | `packages/cluster-mesh/tests/memory-context.spec.ts` (mesh integration; no producer implemented); `packed/identity-source-refusal.test.ts` (Lot 4). |
| P02 | `packed/identity-source-refusal.test.ts` (Lot 4). |
| P03 | `packages/mcp-platform/tests/memory/schema-profile.test.ts` (platform suite; no producer implemented). |
| P04 | `packages/mcp-platform/tests/memory/wire-profile.test.ts` (platform suite; no producer implemented); `packed/sdk-discovery-call.test.ts` (Lot 4). |
| P05 | `packages/mcp-broker/tests/memory/{sqlite-workflow-store,policy-version-persistence}.test.ts` (catalog Lot 2; runner not implemented). |
| P06 | `packages/mcp-broker/tests/memory/{sqlite-workflow-crash,mutation-recovery}.test.ts` (broker suite; no producer implemented); `packed/restart-lost-response.test.ts` (Lot 4). |
| P07 | `packages/mcp-broker/tests/memory/{oidc-assurance,confirmation-continuation}.test.ts` (broker suite; no producer implemented); `packed/confirmation-step-up.test.ts` (Lot 4). |
| P08 | `packed/{exports,disabled-install}.test.ts` (Lot 4). |
| P09 | `packages/mcp-platform/tests/remote-bound-dispatch.test.ts` and `packages/cluster-mesh/tests/registry/remote-adapter.spec.ts` (R2/BR3); `packages/cluster-mesh/tests/registry/host-bridge{,.e2e}.spec.ts` (R7a/BR3). Catalog Lot 3 is not implemented. |
| P10 | Existing tooling sources; no dependency on generating P01-P09 source files. A tooling success cannot substitute for P01-P09. |

Here `packed/` abbreviates `tools/memory-mcp-l5/packed/` only.
The catalog explicitly labels the four missing P09 files as pending predecessor
integrations; neither engram's archive nor its asset generator produces them.

## Receipt blockers independent of test execution

`schema-validator.mjs:351-354` rejects pending predecessor mappings and the absent
Lot 2 `verifier.mjs`, then unconditionally reports three outstanding provenance
obligations: `ci.provenance`, `ownerUat.provenance`, `acceptances.provenance`.
`tests/receipt-contract.test.mjs:326-343` explicitly expects these failures even
for a structurally complete synthetic bundle. No local checkpoint can be accepted
by this implementation. Removing these checks would weaken the gate.

The L4 handoff `candidate-manifest.json` binds the correct tarball to P2, but is
not the aggregate harness manifest: all eight required candidate-stage fields
are absent. The harness requires one artifact each for l4/platform/broker/mesh,
retained P2 contracts, an installed closure and authenticated tuple-bound evidence.
No official candidate-stage packer exists. `exports-v1.json` freezes only
platform/broker exports; it supplies no engram installed-consumer proof.

## Bounded handoff

L5 harness owner: implement the declared Lots 2-5+, source suites, candidate
packing and authenticated provenance verification while preserving the closed
catalog, P2 binding and receipt checks. R2/R7a owners: integrate the exact P09
files above. Observable acceptance: official candidate gate executes every
catalog case on this archive, records six-tool behaviour and disabled-install
0/0/0/0, then `memory-l5-receipt MODE=checkpoint` accepts the real evidence.
No missing proof output has been identified as an engram/gr-conductor-only
artifact; the evidenced blockers are absent harness/predecessor implementations.
