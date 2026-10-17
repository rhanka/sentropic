# Transfers legacy router fixture (`0c5aef04`)

`import-export.ts` and the bridge files are verbatim copies of the `be37d69f6`
snapshot (same Git blobs); only the Drizzle journal is advanced. After rebasing on
main `5202dd87c`, the journal matches `api/drizzle/meta/_journal.json` (blob
`5e84040a187727f35c13f89c4759986c9eff504e`): main's
`0042_oauth_clients_mfa_policy` precedes `0043_immo_token_exchange`, which adds the
nullable `service_clients.exchange_policy` column and changes no export payload.

The unchanged historical imports resolve through individually digest-pinned test-only
bridges to current canonical product authorities. The storage bridge adapts the historical
raw S3-shaped calls to the unchanged canonical `ArtifactStorePort`; it does not implement a
fake store. Production never imports or mounts this fixture, so it cannot act as a fallback
or parallel author.
