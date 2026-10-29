# Pinned candidate qualification

The development-only `@sentropic/engram` 0.22.0 fixture is pinned to:

| Field | Value |
| --- | --- |
| SHA-256 | `0e740e5c8fd9d8bc167d6efcdd0e2bf86a2af5c6accfc2bc1c464e4477b14f08` |
| Integrity | `sha512-YuHv8eJ/rsijXI4ylv+vare3Bu4gCnh3mS3QmDz36T9aJ9pJgjBwXcuTCATBV9C8RQGfYYuFwjkLazrDDILMNQ==` |
| Engram source | `2bd7da41779305831b16c94f1272ab3b9d38128e` |

The Docker qualification checks both hashes before installing the archive.
The archive is outside the published package file set; the frozen substrate
development lock remains unchanged. No published older MCP peer is substituted.

The producer code-splits its public ESM entries over one internal chunk.
`/memory-substrate` and `/mcp-memory` share the engine factory and its private
fenced-store provenance instance. The public exports and neutral contract
remain unchanged. The builtin still requires shared factory identity before
opening storage. `tests/mcp-memory.spec.ts` deliberately supplies split
instances and requires atomic refusal, zero storage opens and no compiled
registry. No private stamp or unfenced exemption is introduced.

The superseded archive (`965c93e326df9866584261061f4e49571cfd74dfe1dc258c0c6894eea121a4e9`)
bundled two private registries and was refused by this guard. It is no longer
the development peer.

The new archive exposed a consumer adapter defect during forget: lexical
removal carries the contract's UTF-8 JSON `null` marker, while the adapter
required an object for every index write. The adapter now preserves that
marker for `memory-accepted-lexical`; other non-object values remain refused.
Lexical removal reads the admitted record's existing index identity within
the same transaction and preserves it while replacing the result with JCS
`null`. It requires that identity to exist. The separate commit index still
preserves producer intent.
The PostgreSQL lifecycle and wire-adaptation regression tests cover this path.

Run `make memory-mcp-qualify ENV=test-memory-mcp` for all six required positive
PostgreSQL, stdio and HTTP cases plus static/lazy/refusal cases and a
separate-process round trip through the shipped stdio launcher. This target
requires the positive cases without skips and shuts down the isolated stack.

The public registry still supplies engram 0.21.3. The owner instruction keeps
cluster-mesh at 0.24.0 until the producer's publication prerequisite changes.
The mandatory package-bump CI gate therefore remains a release blocker for
this draft; no exemption or publication is introduced here.
