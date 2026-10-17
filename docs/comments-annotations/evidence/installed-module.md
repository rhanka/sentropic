# Comments M2 installed candidate evidence

Qualification date: 2026-10-17. This records a candidate archive and synthetic neutral hosts. Publication, merge, owner delivery and real data are separate actions.

## Qualified bytes and dependency closure

| Item | Identity / result |
|---|---|
| Candidate | `@sentropic/cluster-mesh@0.19.0` |
| Frozen optional peer | `@sentropic/comments@0.3.0` |
| Archive SHA-256 | `b4daed28c894de8670b1cf67044f9fd01dd9b740957a76ff0ca8a2f7c19fbe21` |
| Archive integrity | `sha512-QmphHSTpI5xb7BUcKLfDFUOs9KVLcOcJehGo0lbFvEWGsvMOVSW1hjqXIwFLoki4Kx+zS6kODm4/iarLn3ZiMA==` |
| Clean consumer lock SHA-256 | `21241d59c484ca327129cc4d6409339fae9bba7c29ae40785a8cdf0c20815812` |
| Host-only driver | `pg@8.16.3`, one connection, installed as a consumer development dependency |
| Runtime image | `node:24-bookworm-slim`, observed Node `v24.21.0` |
| Database | PostgreSQL 17 Alpine, image digest `sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24` |
| Consumer production audit | 0 vulnerabilities at every severity; 12 production dependencies in this run |
| Checkout runtime imports | 0; resolver hook refuses workspace/probe module resolution |

The archive was built after production commit `5f8351987`. Subsequent test/document changes do not change its runtime bytes. The complete consumer lock and dependency tree record exact resolved transitive versions; this is evidence for that tuple, not an acceptance claim for future registry resolutions.

## Executed installed checks

`make -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk cluster-mesh-comments-installed API_PORT=9620 UI_PORT=5820 MAILDEV_UI_PORT=1720 ENV=test-cm-comments-m2` passed using the actual archive, outside checkout module resolution.

- Bare archive: root, generic storage/Postgres and disabled comments composition import with no comments/driver evaluation. Enabled comments without its peer refuses before module evaluation.
- Frozen corpus: packaged conformance artifact hashes match the packaged manifest; the unchanged M1 corpus passes through issued scopes. All eleven canonical record kinds preserve their literal canonical bytes and hashes.
- Transactions: pending reads and caller rollback pass on one host connection, with no hidden nested external transaction.
- Independent source/destination: 28 revisions containing multibyte/escaped text total **1,592,112 encoded bytes**. Export uses four data fragments and a verified terminal. Reconstructed runtimes complete import in ten bounded seal calls; hidden intake has no canonical head before terminal/publication.
- Original complete receipt: typed unit roots and canonical receipts survive runtime reconstruction and response loss. A current read-only grant recovers the same receipt and reads the full original history; domain denial and persisted grant revocation refuse subsequent reads.
- Contention sample: an ordinary command during hidden import preparation completed in **7.3 ms**. The destination journal contains exactly that command plus one import publication. This is one synthetic sample, not a production latency percentile or a concurrent-load benchmark.
- Actual module discovery and full cluster-mesh runtime/plugin mount pass with verified principal/workspace/invocation grants, server-owned registration and original idempotent replay. Forged body scope, raw lifecycle append and physical-completion submissions refuse without effects.
- Independently authorized lifecycle creates a real purge intent; maintenance erases retained content and only then records completion. No imported claim authorizes physical erasure.

The host owns migration history and injects all SQL execution. No production cluster-mesh module imports `pg` or `drizzle-orm`. The installed fixture imports only public package leaves and packaged assets/oracle; it does not reuse checkout adapters, test kernels or the Sentropic application.

## Reproduce and retain

Build/pack with `make pack-cluster-mesh PACK_DESTINATION=.h2a/build/cm-comments-candidate ... ENV=test-cm-comments-m2`, then run the target above. A different archive must receive its own identity and qualification. The default report directory is `.h2a/build/comments-installed/`:

- `installed-comments.json`: archive identities, oracle pins, measured transport/session facts and namespace results.
- `bare.json`: disabled/missing-peer isolation results.
- `consumer-package-lock.json`, `production-tree.json`, `audit.json`: exact consumer closure and audit.

The same target is wired into `validate-cluster-mesh` after candidate packing. CI uploads these files under `qualify-cluster-mesh-candidate`; its completed run on the pushed commit is the final CI evidence. The branch report records source, real-Postgres and server-SIGKILL gates separately.

Co-owner review of the additive storage-port changes (BRCM2-PORT1–17) is still pending; passing tests do not imply that review. Dedicated review/submission/assignment services, SQLite parity, CommonMark profile qualification, Sentropic application cutover, publication and actual host delivery remain outside this candidate proof. The [host integration guide](../immo-host-guide.md) describes the delivered API and those boundaries.
