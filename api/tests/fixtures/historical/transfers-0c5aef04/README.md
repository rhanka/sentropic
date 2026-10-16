# Transfers legacy router fixture (`0c5aef04`)

`import-export.ts` and the bridge files are verbatim copies of the `be37d69f6`
snapshot (same Git blobs); only the Drizzle journal is advanced. The journal is the
exact `api/drizzle/meta/_journal.json` from commit
`0c5aef048` (blob `98fdd3529a28566c66c9d8d6f34ff35bb7d82823`),
ending at `0042_immo_token_exchange` — the 2-IdP additive migration, which adds the
nullable `service_clients.exchange_policy` column and changes no export payload.

The unchanged historical imports resolve through individually digest-pinned test-only
bridges to current canonical product authorities. The storage bridge adapts the historical
raw S3-shaped calls to the unchanged canonical `ArtifactStorePort`; it does not implement a
fake store. Production never imports or mounts this fixture, so it cannot act as a fallback
or parallel author.
