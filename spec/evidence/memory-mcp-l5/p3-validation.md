# P3 validation evidence

Environment: `test-mem-l5-p3`. Every container/test command uses the shared `/home/antoinefa/.cache-tmp/sentropic-docker.lock`; cleanup uses `make down` for this environment only.

Before modifying frozen bytes, `make memory-l5-tooling ENV=test-mem-l5-p3` passed 101 tests in 11 files, and `make memory-l5-test LOT=1 ENV=test-mem-l5-p3` passed all 183 tests (platform memory 107, request identity 3, wire parity 4, registry dispatch 3, broker 66).
The first tooling rerun could not install Vitest: npm returned `ECONNRESET` before any assertions. It is not a failed qualification assertion or an accepted flaky test. The identical rerun passed after connectivity returned.

Final tooling/L0 regression: `make memory-l5-tooling ENV=test-mem-l5-p3` passed 104 tests in 12 files, including the three real L0 hash guard checks and the existing fail-closed receipt-contract tests.
Final retained P3 inventory/archive/graph verification: `make memory-l5-verify ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json ENV=test-mem-l5-p3` passed, reporting 30 files, 54 edges and the exact P3 manifest digest.
Lot 1 after the correction: `make memory-l5-test LOT=1 ENV=test-mem-l5-p3` passed all 183 tests again; cleanup completed with `make down ENV=test-mem-l5-p3`.

Measured SHA-256 identities:

- Catalog: `9bf377b774dda54a3b37189eea57cb845acca7b27b8b55b399f23c20215a1211`; byte-identical to the approved staging file.
- L0 freeze: `0541b15ba4d5e49ba3b30d92da1c5e3c2fd668e40937e4f942103a678e849bfb`; exactly two field substitutions from `f37b3b9e220ab1043614b14eec34cbd1539b0cb9358d5ecee37f1bf81ad43bc5`.
- P3 manifest: `1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730`; exactly two inventory hash substitutions from `f2b094ae034514727dfe2f4c9a89b3742e3d75beafc8f70e5074cd49d7f16642`.

All 18 retained P09 suite paths exist at base `22d8a9e68b1abae2665fedb528526d2a84c6bc4d`; the rest of the catalog is unchanged. The comparison with historical P2 reproduces exactly the seven inherited scalar deviations recorded in [p3-handoff.md](p3-handoff.md).

The targeted regression calls `verifyOnDiskEvidence` in `schema-validator.mjs`, including its real live catalog/schema hash guard at lines 202–204. It isolates L0 metadata results from other checkpoint prerequisites and checks rejection of each stale hash independently. It does not assert full checkpoint acceptance.

L0 reissue awaits owner authorization. Signature slots remain null/pending in [p3-owner-authorization.json](p3-owner-authorization.json). The metadata guard itself does not verify detached owner signatures; passing it cannot authorize the freeze.
The existing receipt-contract tests keep the checkpoint CLI fail-closed even for a complete synthetic bundle, with exactly these five outstanding Lot 1 obligations:

- `provenance.predecessors: pendingPredecessorMappings remain unresolved (BR3/L5-F1)`
- `assurance.verifier: tools/memory-mcp-l5/verifier.mjs is not yet implemented (Lot 2 obligation)`
- `ci.provenance: trusted CI run provenance is not established by local evidence files`
- `ownerUat.provenance: authenticated owner decision provenance is not established by local actorRef strings`
- `acceptances.provenance: authenticated co-owner acceptance provenance is not established by local actorRef strings`

Thus a full L5 checkpoint is not claimed to fail solely for one missing signature. No P3-bound E4 build, live checkpoint, authenticated CI/owner/co-owner receipt or qualification is fabricated by this correction. Those later-lot obligations and the detached authorization required by the approved specification remain explicit.
