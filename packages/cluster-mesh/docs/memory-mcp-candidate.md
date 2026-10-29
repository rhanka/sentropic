# Pinned candidate qualification blocker

Candidate: `@sentropic/engram` 0.22.0 archive with SHA-256
`965c93e326df9866584261061f4e49571cfd74dfe1dc258c0c6894eea121a4e9`.
Owner: Engram packaging. Consumer: cluster-mesh memory MCP builtin.

The two installed ESM entries independently bundle
`engram-memory/dist/store-factory.js` and its private `fencedFactoryStores`
WeakSet:

- `dist/memory-substrate.js:741` declares its registry; line 747 marks the
  fenced store returned by the neutral adapter.
- `dist/mcp-memory.js:6976` declares another registry; line 6982 checks that
  second registry when the MCP engine or read facets admit a store.
- `dist/mcp-memory.js:8296` applies the provenance check on engine effects;
  line 9272 applies it on current reads.

The archive exports different `createMemoryPortV2` function instances from
these entries. The substrate's canonical PostgreSQL store is therefore absent
from the MCP entry's private registry. Its readiness receipt and real fence
do not override this check.

Observed at consumer commit `b62a1117c` before the receiver added the startup
refusal: `make memory-mcp-qualify ENV=test-memory-mcp` ran the source and test
TypeScript checks successfully, then failed five of eleven assertions across
the PostgreSQL, stdio and HTTP files. The three direct lifecycle tests all
failed at the first capture with the producer's closed domain result:

```json
{"ok":false,"auditId":"audit-memory","redactionClass":"high","error":{"code":"CAPABILITY_UNAVAILABLE","message":"Requested memory capability or required neutral port facet is unavailable.","retriable":false}}
```

Static discovery, peer absence/version/shape refusals and unselected lazy
loading passed. HTTP and stdio preserved discovery schemas. No successful
capture/admission/recall/withdraw/forget qualification is claimed.

The receiver now requires the public entries to share their engine factory
instance and refuses split instances before opening the canonical store.
There is no fallback, provenance stamp injection, native private opener,
unfenced exemption or replacement memory semantics. Positive PostgreSQL
tests remain required and blocking.

Required producer delivery: package the public substrate, engine and read
facets over the same private store-factory instance, preserving the private
provenance gate. Qualify the exact installed archive by opening the neutral
PostgreSQL store through `/memory-substrate` and using it through
`/mcp-memory` for all six tools. Validate pending versus admitted visibility,
receipts, confirmation refusal and two-tenant isolation over stdio and HTTP.
Supply the resulting immutable candidate hash; publication still requires
the separate L5 qualification and receiving acknowledgement.

The owner also forbids a release bump depending on unpublished engram. The
public registry returned engram 0.21.3 during this campaign, so cluster-mesh
stays 0.24.0 in this draft. The mandatory package-bump CI gate is expected
to refuse this head; no release-gate exemption is introduced.
