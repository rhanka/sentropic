# Transfers legacy router fixture (`be37d69f6`)

`import-export.ts` and the Drizzle journal are the exact executable source snapshots from
commit `be37d69f6a7b017589793a348a3c501506f420a0`. Their Git blobs are
`07102840c30953ce293db51fd85adc85bb2e08c7` and
`afd23b5a944fe172bd77bcee5df43ea04c64c429` respectively.

The unchanged historical imports resolve through individually digest-pinned test-only
bridges to current canonical product authorities. The storage bridge adapts the historical
raw S3-shaped calls to the unchanged canonical `ArtifactStorePort`; it does not implement a
fake store. Production never imports or mounts this fixture, so it cannot act as a fallback
or parallel author.
