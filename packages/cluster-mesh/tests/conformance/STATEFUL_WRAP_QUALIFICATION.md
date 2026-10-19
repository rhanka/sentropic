# Stateful MCP wrapping qualification

This receipt qualifies the library contract and isolated installed consumer.
It does not qualify Radar domain handlers, production signals or cutover.

## Package tuple and integrity

Published versions rechecked after merging main `3556df5c6`:
`mcp-platform@0.3.1`, `cluster-mesh@0.19.1`, `artifacts@0.1.2`.
The selected unpublished candidates are `mcp-platform@0.4.0`,
`cluster-mesh@0.21.0` and `artifacts@0.1.3`.
Artifacts 0.1.3 widens its platform peer to `>=0.3.0 <0.5.0`, retaining
0.3 compatibility while admitting the new wire API. Mesh requires artifacts
`>=0.1.3 <0.2.0` so npm never selects the incompatible published 0.1.2 tuple.
No publication or merge was performed.

| Installed archive | SHA-256 |
| --- | --- |
| sentropic-mcp-platform-0.4.0.tgz | 67c9ab88ae51087a21a596facfc8330dea4c43128878c261a4136b6d458885e5 |
| sentropic-cluster-mesh-0.21.0.tgz | af4e08afa58c8461677ce880d16234d3e34a646a05a83329fc7ce7297d0c4dfe |
| sentropic-artifacts-0.1.3.tgz | 919242fc36f456d25ac635c78701bb62588fdfc43ac4362018bc8eac6ee533ca |

These exact archives passed public-subpath imports, strict consumer TypeScript,
missing/incompatible/export/member refusal probes and 15 installed tests covering
C1–C7. The core consumer declares only mesh as a runtime dependency; platform
resolves transitively. Authentication test tools remain dev dependencies. There
are no workspace symlinks or artifacts dependency.
The same installed tree then installs the artifacts archive and passes the
27-tool variant: all twelve captured Immo calls, fifteen discovered artifacts
tools, a real artifacts executor call, verified actor propagation, account
refusal before invocation, and warm session identity.

## Checks

The table records the original R1 checks; the resume checks below use the merged
sources and the embedded-platform consumer.

| Command, with ENV=test-cm-wrap last | Result |
| --- | --- |
| make cluster-mesh-workspace CM_ACTION=platform-test | 29 files, 237 tests passed |
| make test-cluster-mesh | 112 files, 947 tests passed; 57 files / 126 tests retain their environment gates |
| make cluster-mesh-workspace CM_ACTION=stateful-consumer | 5 files, 15 tests passed, public types and peer refusal probes passed |
| make typecheck-cluster-mesh | passed, including cold dependency compilation |
| make lint-cluster-mesh | passed |
| make typecheck-mcp-platform test-mcp-platform api-extract-mcp-platform | canonical root install, 237 tests and API report passed |
| make test-publishable-manifests | 86 passed, including all three complete release tuples and publisher ordering |
| make -f packages/cluster-mesh/packaging.mk test-lazy-package SIBLING_ARCHIVES_FILE=tmp/ci-manifest-guard/siblings/cluster-mesh/receipts.json | 77 passed, including compatible artifacts and verified archive integrity |
| make scope-check -o build-harness | passed before every implementation commit after the initial harness build |

## Resume checks after main integration

All commands below use `ENV=test-cm-mcp-wrap` last.

- `make typecheck-cluster-mesh test-cluster-mesh lint-cluster-mesh`: passed;
  987 tests passed, 129 tests retain their environment gates.
- `make cluster-mesh-workspace CM_ACTION=stateful-consumer`: 15 core tests,
  public TypeScript, refusal probes and the combined 27-tool test passed.
  Host imports use mesh entries only, including the artifacts executor.
- `make test-publishable-manifests`: 86 tests passed.
- `make test-qualify-published-install`: 18 tests passed.
- `make memory-l5-gate LOT=1 ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json`:
  passed, including packed/source graphs, typechecks, tooling and memory/broker tests.
- `make test-mcp-platform`: all 345 tests passed after main integration.
- `make pack-publishable-manifest PACKAGE=cluster-mesh`: guarded candidate passed,
  matching the mesh archive above. `make qualify-published-install` with the CI
  optional-peer tuple and guarded sibling receipts passed all 34 import checks.
- `make -f packages/cluster-mesh/packaging.mk refresh-lazy-package-lock` and
  `test-lazy-package`, using the guarded sibling receipts: passed, 77 tests.
  The frozen lock now records the normal embedded-platform dependency and the
  merged platform archive integrity. Packaging runs with one worker; the offline
  preparation test passed in 2.16s, within its unchanged 5s budget.
- `make memory-l5-pack STAGE=pre-candidate`: regenerated and verified two archives
  and 44 contracts. P1 manifest SHA-256:
  `732b96bc3284fb6f38cf031bd33a9cfe341ee7bc8129741f7e9726a371b66d53`.
  The private broker now resolves platform ^0.4.0; the prior P1 proof is retained
  under its immutable history identity. Both public API extractors passed.
- Harness C1 and C2 passed for the authored changes. During the main merge,
  the local C2 command reported inherited main paths; mechanical C2 on the
  conflict-resolution paths passed, and inherited files matched main exactly.
  Track containment retained all 342 event IDs without a Track write.

Fixture SHA-256 is checked before JSON parsing. The receipt's externalResource is
`https://preprod.immo.sent-tech.ca/mcp`, matching the signed test audience/resource.
Both HTTP and simulation qualification observed a largest raw RPC body of 158
bytes. Schema/argument/result maxima and the explicit proposed host budgets are
recorded in `fixtures/README.md`. The two exact golden JSON files retain their
source trailing blank line; whitespace checks exclude only those two files.

## Review receipt

Author declaration: codex / gpt-6.1-sol / xhigh.
Requested reviewers: claude / claude-opus-4-7 / high and
claude / claude-haiku-4-5-20251001 / high. These are requested identities,
not attestations of effective routing or effort.

First-round peers completed without blocking findings on
`401598a9b234a657e07a91359b8fe0406af80f5b`.
Delta conformance review on `331b9cd2361b2eee98b3233043d09b1ad0ccfc78`
completed with no blocking findings. Its observations are reconciled as follows:

- Accept the Node 24 dependency: all preparation runs in the pinned Docker lane.
- R1 resolves positive artifacts selection with candidate 0.1.3 and the
  installed 27-tool qualification; publishing that version remains CI-owned.
- Retain application-mode unknown-tool messages as the existing explicit contract.
- Retain the conservative array-length rejection before byte-budget traversal.
- Confirm the canonical resource against the immutable deployed-baseline receipt.
- Accept the anchored correlation-ID replacement; captured text bytes remain intact.

The delta security artifact declared xhigh despite the requested high.
That leg is FAILED under the metadata contract; its verdict is rejected.
The final round is incomplete and has no consensus verdict or merge clearance.
Original and failed-leg records remain under `.h2a/reviews/cm-wrap-*-r2*.md`.
Rebase onto spec `8ac9c7c64381c98b1a52d81d6ede8bce2b46ecc7`
preserved all package, lock and workflow bytes; subsequent null-prototype JSON
acceptance and test instrumentation passed the full mesh and installed suites.

## External release gates

R1 regenerates the canonical root lock through `make lock-root` without peer
bypasses. Candidate, post-publication and bootstrap gates include artifacts
0.1.3 alongside platform 0.4.0; mesh publication waits strictly for artifacts.
The frozen installed tuple retains its existing S3/pg versions and records the
guarded candidate archives. CI at the pushed exact HEAD remains the delivery
gate; package publication and the final independent review remain separate.

Radar L5 belongs inside 2b-MCP, after #706 implementation, #689 merge, qualified
published packages and environment receipts. Exchange stays disabled here.
Receiver #865 remains excluded from Radar candidate SHAs until the same
environment has a successful exchange-enabled 2b-MCP cutover receipt.
