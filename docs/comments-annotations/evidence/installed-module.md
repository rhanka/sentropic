# Comments M2 installed candidate evidence

Qualification date: 2026-10-17. This records a candidate archive and synthetic neutral hosts. Publication, merge, owner delivery and real data are separate actions.

## Qualified bytes and dependency closure

| Item | Identity / result |
|---|---|
| Candidate | `@sentropic/cluster-mesh@0.19.0` |
| Frozen optional peer | `@sentropic/comments@0.3.0` |
| Archive SHA-256 | `80df0a45f34fb2b4ea28103d497a9fa596aea9712c4ac9fcf67c35a65d9f1596` |
| Archive integrity | `sha512-JCTjTzgnLZfdue8rWjIHAVlgGmzAhpxNaE6ibak9GxQq1XF5UfN5OYHp5mWRipFJy/TAUsuir8g5H/HnOn5QGQ==` |
| Clean consumer lock SHA-256 | `6798eed1fa0e839b249a0c8f1c4790e14c60d4b214e4b8a33e10c63232719274` |
| Functional report SHA-256 | `9882b6c4ba16a4fb3a7cd10b472b093eee26be7e8cba1a1abf404ce3c0236446` |
| Host-only driver | `pg@8.16.3`, one connection, installed as a consumer development dependency |
| Runtime image | `node:24-bookworm-slim`, observed Node `v24.21.0` |
| Database | PostgreSQL 17 Alpine, image digest `sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24` |
| Consumer production audit | 0 vulnerabilities at every severity; 12 production dependencies in this run |
| Checkout runtime imports | 0; resolver hook refuses workspace/probe module resolution |

The final archive was packed after production commit `5f8351987` and shipped README commit `69c09882f`. The complete consumer lock and dependency tree record exact resolved transitive versions; this is evidence for that tuple, not an acceptance claim for future registry resolutions.

## Executed installed checks

`make -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk cluster-mesh-comments-installed CM_COMMENTS_TARBALL=.h2a/build/cm-comments-final/sentropic-cluster-mesh-0.19.0.tgz API_PORT=9620 UI_PORT=5820 MAILDEV_UI_PORT=1720 ENV=test-cm-comments-m2` passed using the actual archive, outside checkout module resolution.

- Bare archive: root, generic storage/Postgres and disabled comments composition import with no comments/driver evaluation. Enabled comments without its peer refuses before module evaluation.
- Frozen corpus: packaged conformance artifact hashes match the packaged manifest; the unchanged M1 corpus passes through issued scopes. All eleven canonical record kinds preserve their literal canonical bytes and hashes.
- Transactions: pending reads and caller rollback pass on one host connection, with no hidden nested external transaction.
- Independent source/destination: 28 revisions containing multibyte/escaped text total **1,592,112 encoded bytes**. Export uses four data fragments and a verified terminal. Reconstructed runtimes complete import in ten bounded seal calls; hidden intake has no canonical head before terminal/publication.
- Original complete receipt: typed unit roots and canonical receipts survive runtime reconstruction and response loss. A current read-only grant recovers the same receipt and reads the full original history; domain denial and persisted grant revocation refuse subsequent reads.
- Contention sample: an ordinary command during hidden import preparation completed in **8.1 ms** on the final archive (7.3 ms on the preceding README revision). The destination journal contains exactly that command plus one import publication. These are synthetic samples, not production latency percentiles or a concurrent-load benchmark.
- Actual module discovery and full cluster-mesh runtime/plugin mount pass with verified principal/workspace/invocation grants, server-owned registration and original idempotent replay. Forged body scope, raw lifecycle append and physical-completion submissions refuse without effects.
- Independently authorized lifecycle creates a real purge intent; maintenance erases retained content and only then records completion. No imported claim authorizes physical erasure.

The host owns migration history and injects all SQL execution. No production cluster-mesh module imports `pg` or `drizzle-orm`. The installed fixture imports only public package leaves and packaged assets/oracle; it does not reuse checkout adapters, test kernels or the Sentropic application.

## Reproduce and retain

Build/pack into a new empty destination with `make pack-cluster-mesh PACK_DESTINATION=<new-empty-directory> ... ENV=test-cm-comments-m2`, then pass its archive path through `CM_COMMENTS_TARBALL` to the target above. A different archive must receive its own identity and qualification. The default report directory is `.h2a/build/comments-installed/`:

- `installed-comments.json`: archive identities, oracle pins, measured transport/session facts and namespace results.
- `bare.json`: disabled/missing-peer isolation results.
- `consumer-package-lock.json`, `production-tree.json`, `audit.json`: exact consumer closure and audit.

The general `qualify-published-install` candidate gate also passed root and every exported leaf with the exact minimum provider tuple and comments peer: llm-mesh 0.22.0, llm-gateway 0.19.0, mcp-auth 0.2.1, auth-hono 0.15.0, jose 5.10.0, comments 0.3.0. The existing packed lazy/types/bundlers/topology matrix passed 10 files / 63 tests, including selected/latest/session/global trees and old-tuple refusal.

The same target is wired into `validate-cluster-mesh` after candidate packing. CI uploads these files under `qualify-cluster-mesh-candidate`; its completed run on the pushed commit is the final CI evidence. The branch report records source, real-Postgres and server-SIGKILL gates separately.

Co-owner review of the additive storage-port changes (BRCM2-PORT1–17) is still pending; passing tests do not imply that review. Dedicated review/submission/assignment services, SQLite parity, CommonMark profile qualification, Sentropic application cutover, publication and actual host delivery remain outside this candidate proof. The [host integration guide](../immo-host-guide.md) describes the delivered API and those boundaries.
