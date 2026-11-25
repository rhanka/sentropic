# Published peer qualification

The published `@sentropic/engram` 0.28.0 is pinned from npm to:

| Field | Value |
| --- | --- |
| Version | `0.28.0` |
| Integrity | `sha512-GkRvw9Bbo02lxMUKlacRIwllbKlPl3Hva+hSYoezM6+Xc/D2cn6RjkIKJM7KilGqrt87okQ4Y3RKPWass8zsgA==` |
| Engram source | `809af68984943b76227b4d4bbfc8b7f63cfab43f` |

The committed root and tool lockfiles carry the published integrity; the
isolated qualification installs the peer from the registry pin. The frozen
substrate receipt (`engram-substrate-receipt`, published 0.21.3) remains the
comparison baseline. No published older MCP peer is substituted.

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

The public registry now supplies engram 0.28.0 (cluster-mesh 0.27.1 widens the
optional peer range to `>=0.22.0 <0.29.0` while preserving the `0.22.0` floor
and qualifying `0.28.0` in the functional lanes). The mandatory package-bump CI
gate passes on the bumped version, and the release-train qualification tuple
carries the `0.22.0` floor. No exemption is introduced here.
