# Transfers legacy router fixture (`be37d69f6`)

`import-export.ts` and the Drizzle journal are the exact executable source snapshots from
commit `be37d69f6a7b017589793a348a3c501506f420a0`. Their Git blobs are
`07102840c30953ce293db51fd85adc85bb2e08c7` and
`afd23b5a944fe172bd77bcee5df43ea04c64c429` respectively
(router source stays frozen; the journal is re-pinned per migration, currently
`4faa9e279d71d698d87ebfc5eb32c7939d593fde` with the `0042` entry).

The unchanged historical imports resolve through individually digest-pinned test-only
bridges to current canonical product authorities. The storage bridge adapts the historical
raw S3-shaped calls to the unchanged canonical `ArtifactStorePort`; it does not implement a
fake store. Production never imports or mounts this fixture, so it cannot act as a fallback
or parallel author.

Maintenance: the router under test stamps `schema_version` from its own
`drizzle/meta/_journal.json` tail, and the cutover test asserts byte parity
with the live export — so EVERY new `api/drizzle` migration must append its
entry here too (journal only; the frozen router source stays untouched).
