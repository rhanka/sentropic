# MCP-L5 Lot 2 durable reference

Status: **unverified for installed E2/host acceptance**. Draft PR [#771](https://github.com/rhanka/sentropic/pull/771) targets main; do not merge.
Author: Codex, requested model `gpt-6.1-sol`, effort `high`. Source branch: `feat/memory-l5-lot2`, rebased onto `origin/main@2ea238790fe992cdbb8e0202b1a73a937b6a1793` on 2026-10-29 per COMMON-RULES. Both conflicts concerned only the branch plan. No frozen input was changed. Broker is private; no published package source changed, so no publication version comparison applies.

The public `@sentropic/mcp-broker/memory-reference` entry exports `SqliteMemoryWorkflowStoreV1`; broker root and pure memory contracts do not activate SQLite. Broker version is 0.2.0. Workflow state uses owned files, immediate transactions, WAL/FULL, bounded contention, nine-part principal-scoped reservation keys, immutable preimages/digests/policy/default/audit records, finite claims and persisted confirmation/canonical replay pointers. An expired executing lease cannot become a fresh execution. Unknown outcomes remain closed until canonical proof is available. The host must supply and enforce canonical fencing separately.

The signature verifier checks issuer/audience/time/signature, independently resolved enrolled human identity and fresh mapped 2FA. Production pins `https://auth.sent-tech.ca` and refuses with its committed empty roots/unverified mappings. Qualification keys/issuer are separate. No deployed OIDC, enrollment, confirmation attachment or canonical ownership acceptance is claimed.

## Immutable inputs

- P3: `1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730`.
- L0 freeze: `0541b15ba4d5e49ba3b30d92da1c5e3c2fd668e40937e4f942103a678e849bfb`.
- Catalog: `9bf377b774dda54a3b37189eea57cb845acca7b27b8b55b399f23c20215a1211`.
- Published E2 0.21.2: `eaf9a3d520aa9d35b261b406313745b4076299b9087eafc1ce076c49e0a34cc1`; registry SHA-512 verified. Retained by hash under `archives/`.
- Read-only E4 0.22.0: `26a0edd50c338f30593d22ae1f06ac13d82f5557f18558750659bcfefec64c10`; supplied SHA-512 verified. Source `rhanka/engram@dec7c55d5`, built against P3. Retention is not Lot 4 qualification.

No catalog, L0 or P3 manifest byte changed. Historical retention reuses the existing P1 verifier against the retained lock snapshot and reports `qualificationAccepted:false`. The strict live-lock verifier remains unchanged: it refuses the new broker version against the old P3 fingerprint. The broker package/export/version delta requires the schedule's successor-freeze/E4 reconciliation before final installed qualification; it must never be certified across the old and new inventories.

## Checks and limits

Reference-only run: **66 tests passed** across 13 files, including independent-process contention, termination before claim and during execution, close/reopen, original recorded replay, policy history, deadlines/cancellation and signed-token refusals. These tests establish workflow/reference mechanics; their synthetic canonical proof inputs establish no real E2 effect, original canonical receipt or PostgreSQL guarantee.
Tooling: **112 tests passed**, including the frozen envelope, malformed host-digest and canonical-case completeness/binding regressions. Exact byte/report bindings are in `reference-evidence.json`. Complete assertion reports are retained compressed by hash under `reports/`; no skipped/todo source case is accepted. The source import/export graph passed with 55 files and 114 edges, including the explicit reference entry and verifier.
Measured runtime: Node 24.21.0, SQLite 3.53.4, WAL/FULL, no Python executable. Reference archive SHA-256: `bd99756eb2c005cf500e6e223cc99c34480f7ee8877f231fcfbb992924828064`, retained outside P3 with its per-file inventory in `reference-artifact.json`; it includes namespace-only recovery before retry default resolution.
The CI source/reference gate retains P3 and runs the original Lot 1 regressions plus the new reference tests. It is not `L5-MEMORY-V1`. The real Lot 2 gate refuses an absent manifest or the committed unverified fixture.
After merging main #756, the full source gate passed again: tooling 112 tests and the original Lot 1/platform/broker collection 193 tests, including the reference cases. Type checking, the import/export graph and retained-P3 verification passed in the same gate.
After a real manifest is received, the gate also requires `LOT2_CANONICAL_REPORT`: a digest-bound Vitest result with the exact source/manifest/E2/reference archive binding and all five real canonical fencing/crash cases. Source-only results cannot close it. This guard verifies completeness, not authenticated CI or owner acceptance.

## Waiting for gr-conductor and actual acceptance

1. The real `lot2-manifest.json` and exact-byte SHA-256 sidecar, using the existing frozen artifact-manifest Lot 2 envelope: P3 binding, E2 artifact digest/provenance, source, artifacts and closed contract inventory. See the explicitly unverified fixture; its provenance records remain unverified.
2. Exact installed public PG backend/driver bridge, neutral declarations/constructor binding, host/profile/configuration and complete lock/dependency archives, versions, SHA-256 values and applicable registry integrities. The pinned E2 archive alone does not close this tuple.
3. G1–G4 and C9 dispositions, actual constructor name, profile equivalence, candidate/scope liaison, canonical store/journal ownership and final commit/fence semantics for that same tuple. Producer/owner provenance remains required; JSON labels do not authenticate a disposition.
4. Execute installed E2 construction and the full real canonical fencing/effect-plus-original-replay matrix against that tuple: stale competing processes; termination before canonical commit, after commit/before workflow completion, and after completion/before response. Verify one canonical effect and its original receipt. These acceptance items are blocked, not passed or skipped.
5. Authoritative production enrollment/assurance and authenticated reattachment mappings, current L0 detached owner/role dispositions and later owner UAT. The committed production policy stays closed until these exist.
6. Lot 6 reruns all durable cases through the final exact E4 and obtains the co-accepted checkpoint before L4 exit. Neither source CI nor E2 preparation accepts E4.

The post-rebase source gate passed again on 2026-10-29 (`memory-l5-gate LOT=reference`, retained P3, typechecks, 55 files/114 edges, 112 tooling tests and package tests; shared flock, `ENV=test-memory-l5` last). No pr771 review file exists in the shared review directory. Independent review selection is pending: no session catalog endpoint is configured, and the installed `remote llm-mesh start` fails while reading missing account configuration. No peer or consensus verdict is claimed. CI remains required on the pushed final head.

## Successor scope

Lot 3 retains the corrected P09 inventory of 18 suites. Installed transport and canonical-store acceptance remain distinct from these reference source checks.
