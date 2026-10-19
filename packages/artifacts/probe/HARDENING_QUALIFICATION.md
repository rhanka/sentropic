# Artifacts 0.1.4 qualification

- Date: 2026-10-19.
- Qualified source commit: `daf1c49415f8cd5cd5b92e85252fddae45fe30db`.
- Scope: the seven findings in the artifacts-hardening packet, Track `01M5A25DNQ78WRK4618CXBW3HH`.
- Original seven local commits survived the resume; compilation and tests caught and completed the upload decoder call and HTTP replay expectation.

## Local gates

```sh
make typecheck-artifacts lint-artifacts test-artifacts ENV=test-artifacts-hardening
make test-artifacts ENV=test-artifacts-hardening
make test-artifacts-integration API_PORT=9700 UI_PORT=5900 MAILDEV_UI_PORT=1800 ENV=test-artifacts-hardening
make probe-artifacts-packed-consumer ENV=test-artifacts-hardening
make scope-check ENV=test-artifacts-hardening
```

- Typecheck and lint passed. After updating HTTP replay expectations, all 183 unit tests passed across 25 files.
- All 30 integration/E2E tests passed across migration, Postgres, S3, content, pilot-contract and publication suites.
- Security cases cover trusted scope, principal-isolated replay, server-derived hashes, path/count/byte limits, HEAD suppression and error headers.
- A caller-mutation reproduction failed for Buffer before replacing its shared slice with a copied Uint8Array; both Buffer and Uint8Array regression cases now pass.
- Test Postgres/MinIO ran only on the isolated test project without published host ports. Logs inspected; `make down` followed by `make ps` confirmed no remaining services.

## Packed proof

The Make probe packs the real candidate and installs it into consumers without repository mounts or workspace links. Its nested core consumer installs only the artifacts archive with optional peers omitted. It verifies platform imports and `/mcp` fail as absent, then imports `/mcp-core` and runs the 15-tool manifest and ensure/publish/get/list flow. A forged tool storage scope cannot override the host scope. Runtime fetch is trapped before imports.

```text
PACKED_MCP_CORE_OK platform=absent tools=15 manifestDigest=platform-free version=0.1.4 utf8Bytes=32 textValidation=ok corp=same-origin fetchCalls=0
PACKED_CONSUMER_OK tools=15 manifestDigest=d490375b5333083c6aab167b03a1bd251423f642781bfeede583afbefe725d31 version=0.1.4 utf8Bytes=32 textValidation=ok corp=same-origin fetchCalls=0
PACKED_ADAPTERS_OK adapters=2 migrations=2
```

| Archive | SHA-256 |
| --- | --- |
| sentropic-artifacts-0.1.4.tgz | `7755caf83e487f52d0a732beb306a783b8a1da9bb8270bac2e0e731a9567f918` |
| sentropic-mcp-platform-0.3.0.tgz | `37367b44befa14ad0a7e10ccf526743a3d053e81f218c24fb6bfd2ee352ec439` |

Both archives passed the packed-manifest guard. The existing root barrel and `/mcp` retain platform registry exports; consumers without the platform use `/mcp-core` directly. Type declarations still reference platform types.

## Release coordination and review boundary

Registry inspection returned artifacts 0.1.2; #707 reserves 0.1.3. This candidate uses 0.1.4, retains #707's optional platform peer `>=0.3.0 <0.5.0`, and fits both current mesh `>=0.1.0 <0.2.0` and #707's `>=0.1.3 <0.2.0` artifacts ranges. The workspace lock was regenerated through Make. Host migration and deliberate compatibility changes are documented in the package README.

Every implementation hunk was inspected. Independent consensus review is not claimed: exact model/effort metadata for the resumed author is unavailable. No merge or publication is authorized by these local receipts; GitHub CI status is reported separately on the draft PR.
