# W0-close.c restore receipt — TEMPLATE (fill from the real run, no code changes)

> This template stays in the repo. The real receipt lives OUTSIDE the repo
> at `${RESTORE_RECEIPT_DIR:-/tmp/app-cm-restore-receipts}/<run-id>.md`
> (manifest block only); only its path + hashes are indexed into #702.
> Never commit private data.

- run_id: `restore-<YYYYMMDDTHHMMSSZ>`
- date (UTC):
- operator:
- repo head (restore target, `git rev-parse HEAD` at execution):
- command (exact, from `docs/runbooks/app-cm-baseline-restore.md` §3):
  ```bash
  make k8s-pgbackup-restore \
    PG_BACKUP_KEY=pg/<timestamp>.sql.gz \
    PG_BACKUP_SHA256=<64-hex-digest-of-the-object> \
    RESTORE_KUBECONFIG=<path-to-restore-namespace-kubeconfig> \
    RESTORE_KEEP_DB=true \
    ENV=test-app-w0c
  ```
- source object: bucket / key / version
  - key:
  - sha256 (pre-restore, `sha256sum` of the downloaded candidate):
  - s5cmd ETag (`ls --etag`):
  - s5cmd versions (`ls --all-versions`):
- manifest block (verbatim `MANIFEST-BEGIN` … `MANIFEST-END` from the run):
  ```json
  <paste here>
  ```
- manifest checks: `sha256_checked:true`, `sha256` equals the pre-restore
  digest, `etag` equals the `ls --etag` value, `bytes` equals the object
  size, `listing`/`versions` intact.
- authority checks (kept DB, then drop):
  - grants hold / revoked readers still deny:
  - `organizations` count matches manifest + B02 counts:
  - nothing written outside the restore namespace:
- recovery duration (start → verified):
- credential rotation done (scoped creds revoked after the rehearsal):
