# Config legacy router fixture (`f34b609f4`)

`business-config.ts` and `me.ts` are exact executable source snapshots from
commit `f34b609f4`. Their Git blobs are respectively
`5a80ba0c6672353b2d26dca24b842977d3d65f8b` and
`3fcc96146e7ee58ace12e0f3cd49fccb4ee7fe73`; the cutover test recomputes both
identities before either router executes.

The unchanged historical imports resolve through test-only bridges to the
current canonical PostgreSQL schema and helpers. Production never imports or
mounts this fixture, so it cannot act as a fallback or parallel author.
