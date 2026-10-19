# Stateful MCP wrapping qualification

This receipt qualifies the library contract and isolated installed consumer.
It does not qualify Radar domain handlers, production signals or cutover.

## Package tuple and integrity

Published versions observed before implementation and after rebase:
`mcp-platform@0.3.0`, `cluster-mesh@0.19.1`.
The selected unpublished candidates are `mcp-platform@0.4.0`,
`cluster-mesh@0.21.0` and `artifacts@0.1.3`.
Artifacts 0.1.3 widens its platform peer to `>=0.3.0 <0.5.0`, retaining
0.3 compatibility while admitting the new wire API. Mesh requires artifacts
`>=0.1.3 <0.2.0` so npm never selects the incompatible published 0.1.2 tuple.
No publication or merge was performed.

| Installed archive | SHA-256 |
| --- | --- |
| sentropic-mcp-platform-0.4.0.tgz | e5e411a08e102be079f2cd7710d9fcd1cb1c3a1951dd1d5c0298ccc12cdc15e2 |
| sentropic-cluster-mesh-0.21.0.tgz | c6d02aff7e6aa9e5e7088103ee121768eea8827c1457ddf8ae87a85b2187ff36 |
| sentropic-artifacts-0.1.3.tgz | 919242fc36f456d25ac635c78701bb62588fdfc43ac4362018bc8eac6ee533ca |

These exact archives passed public-subpath imports, strict consumer TypeScript,
missing/incompatible/export/member refusal probes and 15 installed tests covering
C1–C7. The core consumer contains no workspace symlinks or artifacts dependency.
The same installed tree then installs the artifacts archive and passes the
27-tool variant: all twelve captured Immo calls, fifteen discovered artifacts
tools, a real artifacts executor call, verified actor propagation, account
refusal before invocation, and warm session identity.

## Checks

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
