# PR 818 CI diagnosis — 2026-10-28

Failed head: `76c62251d32d707bddac0327b01a08622c68daf7`, run
[`40741738278`](https://github.com/rhanka/sentropic/actions/runs/40741738278).
Both complete job logs were downloaded with `gh api repos/rhanka/sentropic/actions/jobs/<id>/logs`.

- Qualification job `123006558430` passed build, typecheck, lint and memory
  (222 passed, 23 explicitly blocked Stage B cases). The common lane then failed
  at 18:45:38 UTC with `ETARGET: No matching version found for @aws-sdk/core@^3.978.7`.
- Registry publication timestamps establish the dependency gap:
  `credential-provider-sso@3.973.22` at 18:44:28.289 UTC,
  `credential-provider-http@3.972.80` at 18:44:38.893 UTC,
  `checksums@3.1001.7` at 18:44:40.800 UTC and
  `middleware-sdk-s3@3.972.83` at 18:45:03.545 UTC all require core `^3.978.7`.
  Core `3.978.7` was published at 18:47:57.212 UTC.
- Artifacts job `123006559937` reached both packed-consumer success markers,
  then failed at 18:44:53 UTC during the fresh S3 SDK/pg install. Its recipe
  discarded npm stderr, so the exact npm diagnostic was not retained. That
  install resolves the same newly published AWS dependencies during the gap.
- Both recipes pin `client-s3@3.1095.0`, whose transitive AWS ranges still resolve
  against the live registry. The E11 Engram/dev.6 tuple is not used by this install.

After registry publication completed, the unchanged common target passed all
11 tests. The full packed-consumer target passed its example compilation,
core/platform consumer checks and `PACKED_ADAPTERS_OK adapters=3 migrations=2 activationSql=1`.
The artifacts archive SHA-256 is identical to failed CI:
`1b09db07f8e765e3d587a106cf42e7d7e01b1aa298d99d8e0ae1aaf02af56c02`.

The Makefile correction preserves npm stderr and completes the `test-mem-e11`
selectors needed to run these exact gates through the existing disposable
Compose project. Assertions, dependency versions, locks and integrity fields
are unchanged. Qualification acquires the shared Docker flock per lane and
tears down after each lane; the packed probe uses the same flock and `make down`.

Full logs and registry metadata are retained outside git in
`.tmp/packets/pr818-ci-40741738278/`. Final local and exact-head CI receipts are
retained there after completion, avoiding a new commit that would move the head.
The retained tuple SHA-256 remains
`66fa8eeef276dfd73fdb9440f589dbdeff33417e8650b55ac354e894cd547527`.
