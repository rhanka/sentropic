# Comments M2 installed candidate evidence

Qualification date: 2026-10-17. This records a candidate archive and synthetic neutral hosts. Publication, merge, owner delivery and real data are separate actions.

## Qualified bytes and dependency closure

| Item | Identity / result |
|---|---|
| Candidate | `@sentropic/cluster-mesh@0.19.0` |
| Frozen optional peer | `@sentropic/comments@0.3.0` |
| Archive SHA-256 | `540ab45ad377d08e4b11dc337479b302970223237aafa61a60ec52d2ccd2c905` |
| Archive integrity | `sha512-u+TAKcorc6X7eswRx5+nhICWHOGDG5RpmCsVfxDnOAGf0M0EAqEvlMJm9KkXnCWLseUxsLj/tiSPMm9ISbPSRQ==` |
| Clean consumer lock SHA-256 | `71b05e6a8f02c26b7d17d0870060e21d7f89a51d2e4c8c60729f748fec282616` |
| Functional report SHA-256 | `c6fce36a6b34298123848d8ec51c7e684ec26d5888d43f08c43a9559af4572cd` |
| Host-only driver | `pg@8.16.3`, one connection, installed as a consumer development dependency |
| Runtime image | `node:24-bookworm-slim`, observed Node `v24.21.0` |
| Database | PostgreSQL 17 Alpine, image digest `sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24` |
| Consumer production audit | 0 vulnerabilities at every severity; 12 production dependencies in this run |
| Checkout runtime imports | 0; resolver hook refuses workspace/probe module resolution |

The fix2 archive was packed after production commit `21b6b105c`. It supersedes the earlier
`80df0a45...` archive. The exact consumer lock/tree/audit and functional report are retained in
`.h2a/build/comments-fix2-installed/`; this evidence covers that tuple, not future registry resolutions.

## Executed installed checks

`make -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk cluster-mesh-comments-installed CM_COMMENTS_TARBALL=.h2a/build/cm-comments-fix2-candidate/sentropic-cluster-mesh-0.19.0.tgz CM_COMMENTS_REPORT=.h2a/build/comments-fix2-installed API_PORT=9620 UI_PORT=5820 MAILDEV_UI_PORT=1720 ENV=test-cm-comments-m2` passed using the actual archive, outside checkout module resolution.

- Bare archive: root, generic storage/Postgres and disabled comments composition import with no comments/driver evaluation. Enabled comments without its peer refuses before module evaluation.
- Frozen corpus: packaged conformance artifact hashes match the packaged manifest; the unchanged M1 corpus passes through issued scopes. All eleven canonical record kinds preserve their literal canonical bytes and hashes.
- Transactions: pending reads and caller rollback pass on one host connection, with no hidden nested external transaction.
- Independent source/destination: 28 revisions containing multibyte/escaped text total **1,592,112 encoded bytes**. Export uses four data fragments and a verified terminal. Reconstructed runtimes complete import in ten bounded seal calls; hidden intake has no canonical head before terminal/publication.
- Original complete receipt: typed unit roots and canonical receipts survive runtime reconstruction and response loss. A current read-only grant recovers the same receipt and reads the full original history; domain denial and persisted grant revocation refuse subsequent reads.
- Contention sample: an ordinary command during hidden import preparation completed in **16.9 ms**. The destination journal contains exactly that command plus one import publication. This is a synthetic sample, not production latency percentiles or a concurrent-load benchmark.
- Actual module discovery and full cluster-mesh runtime/plugin mount pass with verified principal/workspace/invocation grants, server-owned registration and original idempotent replay. Forged body scope, raw lifecycle append and physical-completion submissions refuse without effects.
- Independently authorized lifecycle creates a real purge intent; maintenance erases retained content and only then records completion. No imported claim authorizes physical erasure.

The host owns migration history and injects all SQL execution. No production cluster-mesh module imports `pg` or `drizzle-orm`. The installed fixture imports only public package leaves and packaged assets/oracle; it does not reuse checkout adapters, test kernels or the Sentropic application.

## Real PostgreSQL major upgrade

The same archive passed `cluster-mesh-pg-major-upgrade` from PostgreSQL **17.11 to 18.6**.
The restored catalog raised typed `schema-drift`. An independent clean same-layout target database
supplied the approved fingerprint; host receipt CAS and append-only operator audit re-attested it.
Reopening then resumed the original saved exact-head cursor and returned the original second record.
The pinned PG18 image is `sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873`.
The full result is retained in `.h2a/build/comments-fix2-major-upgrade/major-upgrade.json` and wired
into CI's candidate artifact. Source re-attestation probes also reject stale approval and actual DDL drift.

## Reproduce and retain

Build/pack into a new empty destination with `make pack-cluster-mesh PACK_DESTINATION=<new-empty-directory> ... ENV=test-cm-comments-m2`, then pass its archive path through `CM_COMMENTS_TARBALL` to the target above. A different archive must receive its own identity and qualification. The default report directory is `.h2a/build/comments-installed/`:

- `installed-comments.json`: archive identities, oracle pins, measured transport/session facts and namespace results.
- `bare.json`: disabled/missing-peer isolation results.
- `consumer-package-lock.json`, `production-tree.json`, `audit.json`: exact consumer closure and audit.

The general `qualify-published-install` candidate gate also passed root and every exported leaf with the exact minimum provider tuple and comments peer: llm-mesh 0.22.0, llm-gateway 0.19.0, mcp-auth 0.2.1, auth-hono 0.15.0, jose 5.10.0, comments 0.3.0. The existing packed lazy/types/bundlers/topology matrix passed 10 files / 63 tests, including selected/latest/session/global trees and old-tuple refusal.

The same target is wired into `validate-cluster-mesh` after candidate packing. CI uploads these files under `qualify-cluster-mesh-candidate`; its completed run on the pushed commit is the final CI evidence. The branch report records source, real-Postgres and server-SIGKILL gates separately.

Co-owner review of the additive storage-port changes (BRCM2-PORT1–17 and U1–U7) is still pending; passing tests do not imply that review. Dedicated review/submission/assignment services, SQLite parity, CommonMark profile qualification, Sentropic application cutover, publication and actual host delivery remain outside this candidate proof. The [host integration guide](../immo-host-guide.md) describes the delivered API and those boundaries.
