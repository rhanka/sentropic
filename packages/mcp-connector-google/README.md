# @sentropic/mcp-connector-google

Private Google Drive and Gmail read-only adapters against the frozen
`@sentropic/mcp-platform` contract. The fixture adapters remain hermetic; separate live
adapters use a token resolved only by `ctx.getSecret('googleOAuthAccessToken')` to call the
real Google APIs. There is no OAuth runtime, API dependency, gateway, or migration.

## Providers

- Google Drive: resources `about.get`, `files.get`; tools `files.list`, `files.export`, `permissions.list`.
- Gmail: resources `messages.get`, `threads.get`; tools `messages.list`, `labels.list`.

Every live fetch path invokes `ctx.getSecret('googleOAuthAccessToken')` as the audited
secret-by-reference seam. Fixture execution makes no network requests. Neither adapter logs,
emits, or returns the resolved secret value.

## Account and workspace mounting

Multi-account support means one distinct `connectorInstanceId` per connected Google account;
`mountedConnectorId(provider, connectorInstanceId)` makes that mapping explicit for callers.
Workspace segmentation remains the platform enrollment concern on
`ConnectorEnrollment.workspaceRef`. When production wiring is introduced later, the API's Google
account identifier should map to that distinct `connectorInstanceId`; it is deliberately not
implemented in this benchmark package.
