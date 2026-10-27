# W0-close.d CI fixture qualification

Run `40590375006` on `def8494e938b54ef085d6aac94c0e4b9b379bd40` passed `typecheck-lint-api`, Artifacts, Cluster Mesh and both image builds. Its complete test matrix exposed fixture mismatches beyond Opus r2's build prerequisite finding:

- Smoke: a second editor had no approved tenant membership; catalog discovery returned 403. Reuse the approved `beforeEach` user, retaining all status assertions.
- E2E: active seeded accounts had workspace membership but no tenant approval. Logs showed `catalog: unavailable`, zero chat tool calls, and catalog HTTP 403. Seed tenant membership for the four active accounts; the pending account remains unapproved.
- Endpoints shard 2: the immutable Resources fence omitted W2.b's artifact routes. Preserve exact path equality, enumerate all four artifact endpoints, and assert both guards on their prefix. Two negative cases remove each guard independently.
- Endpoints shard 4: all 263 assertions passed, but forced database deletion emitted PostgreSQL 57P01 during pooled connection shutdown. Use normal deletion after `pool.end()`, matching the other artifact fixtures.

BR00D-EX6/EX7/EX8 bound these test-only corrections. Production authorization, activation, tuple bytes, assertions and timeouts are unchanged apart from the added fence assertions.

## Local verification

All runtime commands held `/home/antoinefa/.cache-tmp/sentropic-docker.lock`, with `ENV=test-app-w0d` last and API/UI/Maildev ports 8798/5184/1091.

- Canonical `make up-api-test` passed. Complete smoke passed (13 tests), including catalog 200/401/404/503/recovery 200.
- `make test-api-endpoints SCOPE='tests/api/root-mount-fence-completeness.test.ts tests/api/artifacts-host-recovery.test.ts tests/services/catalog/chat-turn.integration.test.ts' API_TEST_WORKERS=1` passed: fence 69 tests, recovery 20 tests, and chat-turn authority/denial regressions.
- The seed initially encountered an older local signing key. After resetting only the dedicated test environment volumes, source seeding completed with a disposable signing key. The temporary probe required ESM mode; no product change was needed.
- At `23:10:18Z`, each seeded active account passed live catalog HTTP and turn authority, then HTTP 403/turn denial after suspension, then successful restoration after reapproval. Probe source is retained under `tmp/pr796/qualification/authority-probe.mts`.
- Mechanical scope C2 passed. Every runtime pass ended with locked `make down ENV=test-app-w0d`; the final four containers and network were removed.

Logs: `/tmp/pr796-fixtures-qualification.log` SHA-256 `fd64edefe5dd6de9981050d295ebab8d0e8a49100b725a28492734e83b59f264`; `/tmp/pr796-seed-final.log` SHA-256 `1c75d04aea2e46a34baecdc859e8d778e44a72d1e512969d53da3deb0f2f4247`.

The original run also reported a missing References assertion in the AI generation E2E; no assertion was relaxed. Final-head CI qualification and any retry evidence are recorded in PR #796.
