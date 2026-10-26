# Lot 3 transport/context source evidence

Draft PR: https://github.com/rhanka/sentropic/pull/777 (base `main`, no merge).
This is source/regression evidence, not an accepted `L5-MEMORY-V1` checkpoint.
The exact test head, complete compressed JSON reports and publication observations are indexed in `source-evidence.json`.
Local validation at source head `82641829615d3b264da07cc97e7a46e3b0112add`: 136 platform tests, 31 mesh tests (including three negative HTTP attachment cases), and 119 tooling tests pass. Source reports contain zero failed/pending/todo cases. Docker steps use the shared lock and `ENV=test-mem-l5-lot3`.

| Catalog area | Source evidence produced by Lot 3 |
| --- | --- |
| P01 | Full verified context, claims and source/generation guards; concurrent subjects/tenants with distinct workspaces; actual SDK HTTP discovery/call through the compiled registry. |
| P02 | Missing/substituted audit and broker audit refusal retain protocol `-32603`; unexpected exceptions use constant sanitized messages. Existing literal-true guards remain exercised. |
| P03 | Explicit finite draft-2020-12 admission, nested unions, closed fields, Unicode/UTF-8, u64, UTC calendar instants and JSON value equality; reviewed L0 assets supply the schema oracle. |
| P04 | Entire envelope in structured/text channels, discovery output schema/metadata, mutation carriers, independent full-envelope and escaped 2 MiB limits, exact/+1 and multibyte cases. The SDK descriptor retains the entire frozen output schema and adds its required root object type. |
| P09 | All 18 catalog suites, including the three packed-consumer cases, run without skipped/todo cases. See retained reports for the exact tested head and counts. |
| P10 | Tooling tests cover archive integrity and complete catalog dispositions; final tuple receipts remain blocked below. |

## Immutable inputs and ownership

- P3 remains `1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730`; its frozen archive contract inventory, catalog, L0 authority, archives and snapshots are unchanged. The runner revalidates the archive closure and ancillary files.
- Catalog SHA-256: `9bf377b774dda54a3b37189eea57cb845acca7b27b8b55b399f23c20215a1211`; L0 freeze SHA-256: `0541b15ba4d5e49ba3b30d92da1c5e3c2fd668e40937e4f942103a678e849bfb`.
- The full source platform manifest is restored to the P3 source revision (`0.4.0`, SHA-256 `b5e64a4506fe7bdbb38c7b0b5fdfe64f88dacc0874259a994a01128d9673c948`). The inventory's `eaa3da5c...` hashes its minimal `/memory` packed manifest, rather than that full source manifest.
- E4 input remains `26a0edd50c338f30593d22ae1f06ac13d82f5557f18558750659bcfefec64c10`; the read-only producer archive was copied by hash and matches the already retained Lot 2 archive.
- The two Immo fixture hashes remain identical to Lot 2. The default codec and predecessor routes are retained.
- The owner's 2026-10-18 memory-first decision and approved registry schedule admit `#685 -> L5 -> R2/R7a/R3`. This packet authorizes the Lot 3 writer window. Remote implementation/publication is not asserted here.
- `make memory-l5-lot3-evidence` produces fresh inputs through `memory-l5-lot3-publications`: npm view of platform `0.4.0`, mesh `0.22.4`, gateway `0.21.3`, and engram E2 `0.21.2`; actual tarball downloads; recomputed SHA-512 compared with `dist.integrity` and a real npm-generated registry observation lock. Commands, metadata, timestamps, archive hashes, lock entries and the complete compressed lock are retained in `source-evidence.json` reports. This observation lock does not replace the pending host lock. No publication provenance/signature acceptance is claimed.
- Mesh peer widenings remain `0.19.2 || >=0.22.0 <0.29.0` for llm-mesh and `>=0.19.0 <0.22.0` for llm-gateway.
- Platform stays `0.4.0`; mesh `0.22.5` retains `>=0.4.0 <0.5.0`. Existing E4 pins platform `0.4.0` and broker `0.1.0`. No new freeze or E4 repack is authorized by this correction.

## Stopped dependencies

The producer is **gr-conductor**. Every row below requires the verified P3-bound `lot2-manifest.json` and sidecar; source tests do not close installed proofs.

| P-item | Missing input/evidence |
| --- | --- |
| P01.packed | Host context/source closure and same-E4 identity/source refusal suite. |
| P02.packed | Canonical E2 audit/literal-true verdict receipts and same-E4 refusal suite. |
| P03 | Manifest-bound neutral declarations, profile and installed lock closure for schema/digest qualification. |
| P04.packed | Manifest-bound transport tuple and same-E4 SDK discovery/call suite. |
| P05 | Actual backend/PG-driver/configuration and canonical fenced-store original/replay report. |
| P06 | Same-tuple E4 restart, crash/lost-ack and recovery evidence. |
| P07 | Same-tuple assurance/confirmation continuation receipts and E4 step-up suite. |
| P08 | Complete installed archive/lock closure, E4 exports and disabled-install suites. |
| P10 | G1-G4/C9 dispositions, final tuple-bound receipts, owner UAT and co-acceptances. |

`summary.json` lists every catalog file and case with existence and explicit `run-here` or `out-of-lot` status, plus its other gate or manifest/E4 dependency. Missing disposition mappings fail. Strict `memory-l5-test LOT=3` still requires the real Lot 2 canonical report and manifest. Lot 4 retains S1 composition, full contract-byte comparison and six installed suites.

The CI version policy currently conflicts with the frozen version: `enforce-package-bump` rejects platform source changes when `main` and this PR both declare `0.4.0`. The author preserves P3 and leaves this policy decision to the conductor; no exemption or gate bypass has been added. Final-head Actions results remain separately required.

Lot 4 estimate: **6-10 agent-hours after its actual inputs and S1 are ready**, excluding producer/owner/CI queue waits. No merge, publication, registry registration or deployed activation is claimed by this PR.
