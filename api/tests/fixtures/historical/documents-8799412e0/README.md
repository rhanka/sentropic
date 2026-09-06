# Documents legacy router fixture (`8799412e0`)

`documents.ts` is the exact executable source snapshot from commit
`8799412e0ce074e228825dd828061dc481d90abd`. Its Git blob is
`e7cf8fd53df0f5ad95be0124a0f3dcd651540b13`; the cutover test recomputes this
identity before the router executes.

The unchanged historical imports resolve through individually pinned test-only
bridges to current canonical product authorities. Production never imports or
mounts this fixture, so it cannot act as a fallback or parallel author.
