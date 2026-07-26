# @sentropic/mcp-connector-google

Private, hermetic benchmark adapters for Google Drive and Gmail against the frozen
`@sentropic/mcp-platform` contract. They contain read-only manifests, synthetic fixtures,
and no OAuth runtime, real token, network call, API dependency, gateway, or migration.

## Providers

- Google Drive: resources `about.get`, `files.get`; tools `files.list`, `files.export`, `permissions.list`.
- Gmail: resources `messages.get`, `threads.get`; tools `messages.list`, `labels.list`.

Every fetch path invokes `ctx.getSecret('googleOAuthAccessToken')` as the audited
secret-by-reference seam, but fixture execution never logs, emits, or returns the resolved value.

## Account and workspace mounting

Multi-account support means one distinct `connectorInstanceId` per connected Google account;
`mountedConnectorId(provider, connectorInstanceId)` makes that mapping explicit for callers.
Workspace segmentation remains the platform enrollment concern on
`ConnectorEnrollment.workspaceRef`. When production wiring is introduced later, the API's Google
account identifier should map to that distinct `connectorInstanceId`; it is deliberately not
implemented in this benchmark package.
