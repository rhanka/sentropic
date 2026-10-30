# Memory MCP builtin

`@sentropic/cluster-mesh/mcp/memory` exports `createEngramMemoryBuiltin`
and `registerEngramMemoryTools`. The builtin follows the artifacts registry
path: static catalog, explicit selection, qualified optional peer acquisition,
then an in-process producer. Cataloging never opens a store. A missing,
partial or incompatible engram peer refuses compilation before storage opens.

This draft qualifies the engram 0.22.0 candidate with SHA-256
`0e740e5c8fd9d8bc167d6efcdd0e2bf86a2af5c6accfc2bc1c464e4477b14f08`.
The test archive is a development fixture, outside the published file set.
Release versioning and the published peer pin await engram L5 qualification.
The archive shares the private provenance instance across its public entries;
see [candidate qualification](memory-mcp-candidate.md). A peer that splits
that instance is refused before storage opens.

The host supplies an `EngramMemoryDefinitionOptions` through `definition`.
It contains persisted host/tenant opt-ins, an opened PostgreSQL kernel,
its host binding and driver, the scope resolver/store identity, deadline,
clock, engine dependencies, provider ports, and configuration provenance.
This builtin is PostgreSQL-only for memory milestone 1; SQLite is milestone 2.
The builtin opens the canonical adapter through
`createMemoryNeutralHandle`, then gives the engine and read facets the same
dependency set and store. No unfenced exemption is accepted.

The nine bindings map directly to the producer contract:

| Binding | Definition source |
| --- | --- |
| invocation | `hostBindings.invocation`; transport `resolveContext` |
| authorization | `dependencies.authorization`; provider read/write authentication and authorization |
| domainPolicy | `dependencies.admission_policy`; `provider.writeHost.policy` |
| engine | composed engine/read facets over the canonical store and acquired fence |
| mutationRecovery | `provider.writeHost.reservation` |
| confirmation | `provider.writeHost.confirm`; enrolled `sent-tech.ca` host attestation |
| audit | `provider.writeHost.audit` |
| pagination | `provider.readHost.pages` and continuation authorization |
| lifecycle | clock/deadline, key custody and coverage ports |

The host owns migrations, grant registration and pool lifecycle. Grants must
be registered before selected compilation. All fields in the verified A03
invocation binding come from the host attachment, including the authoritative
tenant, workspace, client, logical session, purpose and envelope references.
Tool arguments cannot select a tenant or authorize confirmation. The host
supplies the immutable plan consumed by the producer's compiled dispatch.

Register native wire tools only after successful registry compilation.
`registerEngramMemoryTools` checks the compiled tool identities and input
schemas, uses qualified platform bridge/schema loaders, and preserves the
producer's schemas, annotations, metadata, text and structured receipts.
The builtin manifest advertises SDK-compatible object roots for input and
output schemas, retaining every producer constraint (including `oneOf`).
The adapter keeps the original producer manifest and validation. Hosts
compute their reviewed compatibility digest with
`computeManifestDigest(createEngramMemoryWireManifest(MEMORY_PROVIDER_MANIFEST))`;
`createEngramMemoryWireManifest` is a pure export of the memory entry point
and does not load Engram or open storage. Generic registry consumers can
serve the builtin manifest directly without replacing its schemas.
Attach the resulting SDK server to the host's stdio or HTTP transport.
The host resolver must verify HTTP authentication or establish stdio identity
out of band. An h2a host must merge the runtime's descriptors and adapter
dispatch into its single tool registry before its SDK handler registration.
The stdio example owns a fresh server. This library does not alter an agent's
h2a installation or opt-ins.

The shipped stdio example loads a trusted host module exporting
`async createHost({modules})`. It returns `{definition, transport,
compatibility, close}`. `transport` is an `EngramMemoryTransportDefinition`;
`compatibility` contains the reviewed wire manifest digest keyed by
`sentropic.engram.memory`. `close` closes host-owned resources after the
builtin store and MCP server have closed.

```sh
node node_modules/@sentropic/cluster-mesh/examples/memory-mcp-stdio.mjs --definition /absolute/path/to/host-definition.mjs
```

Configure that command as the agent's MCP server command. The host module is
required: this draft ships no permissive identity, retention, confirmation,
custody or database defaults. Pending capture is not admission. Read
`outcome.status` after admission; tombstoning is not physical purge.

Qualification: `make memory-mcp-qualify ENV=test-memory-mcp` provisions real
PostgreSQL under the shared Docker flock, runs the six positive transport
and lifecycle cases plus six static/refusal cases, and starts the shipped
launcher in a separate process. The MCP SDK client discovers all six tools,
captures pending material, verifies it is absent from search, admits and
reads it, forgets it, verifies it is absent again, and withdraws a second
pending candidate. The command and structured tool receipts are retained in
`tmp/memory-mcp-receipts/tools.log`. The target shuts down the isolated stack.

The launcher qualification compiles the explicit test host in
`tests/engram-memory/mcp-launcher-host.ts` beside the same emitted library
modules. Its fixture identity, clock, policy and custody are test authorities;
they are outside the published file set and are not production host defaults.
