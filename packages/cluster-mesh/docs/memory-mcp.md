# Memory MCP builtin

`@sentropic/cluster-mesh/mcp/memory` exports `createEngramMemoryBuiltin`
and `registerEngramMemoryTools`. The builtin follows the artifacts registry
path: static catalog, explicit selection, qualified optional peer acquisition,
then an in-process producer. Cataloging never opens a store. A missing,
partial or incompatible engram peer refuses compilation before storage opens.

This draft qualifies the engram 0.22.0 candidate with SHA-256
`965c93e326df9866584261061f4e49571cfd74dfe1dc258c0c6894eea121a4e9`.
The test archive is a development fixture, outside the published file set.
Release versioning and the published peer pin await engram L5 qualification.

The host supplies an `EngramMemoryDefinitionOptions` through `definition`.
It contains persisted host/tenant opt-ins, an opened PostgreSQL kernel,
its host binding and driver, the scope resolver/store identity, deadline,
clock, engine dependencies, provider ports, and configuration provenance.
SQLite remains refused. The builtin opens the canonical adapter through
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
Attach the resulting SDK server to the host's stdio or HTTP transport.
The host resolver must verify HTTP authentication or establish stdio identity
out of band. h2a can register these tools on its existing server through this
same entry; this library does not alter an agent's h2a installation or opt-ins.

The shipped stdio example loads a trusted host module exporting
`async createHost({modules})`. It returns `{definition, transport,
compatibility, close}`. `transport` is an `EngramMemoryTransportDefinition`;
`compatibility` contains the reviewed producer manifest digest keyed by
`sentropic.engram.memory`. `close` closes host-owned resources after the
builtin store and MCP server have closed.

```sh
node node_modules/@sentropic/cluster-mesh/examples/memory-mcp-stdio.mjs --definition /absolute/path/to/host-definition.mjs
```

Configure that command as the agent's MCP server command. The host module is
required: this draft ships no permissive identity, retention, confirmation,
custody or database defaults. Pending capture is not admission. Read
`outcome.status` after admission; tombstoning is not physical purge.

Qualification: `make engram-e2-postgres-up ENV=test-memory-mcp`, then
`make test-cluster-mesh SCOPE=mcp-memory CM_PG_URL=postgresql://app:app@postgres:5432/app ENV=test-memory-mcp`,
under the shared Docker flock. Run `make down ENV=test-memory-mcp` afterwards.
