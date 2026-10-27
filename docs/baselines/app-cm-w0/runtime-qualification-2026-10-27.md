# W0-close.d 0.2.4 startup and transport qualification

Qualified code source: `762ad377f036448631d2e99732e339a5d3bd1059`, with integration `ca3239295` and published artifacts source `60affbaf6` merged first. APP-P1 manifest: `020aacfec500d754b76c90d3ad4a05097e0f996b8b9282145ca458917ea6fb27`.

Every build/start/test command held `/home/antoinefa/.cache-tmp/sentropic-docker.lock`. The dedicated Compose environment was `test-app-w0d`; API/UI/Maildev ports were `8798/5184/1091`, verified free before starting. No provider credentials or production configuration were supplied.

## API startup proof

- `make build-artifacts up-api-test REGISTRY=local API_VERSION=pr796-w0d TARGET=development API_PORT=8798 UI_PORT=5184 MAILDEV_UI_PORT=1091 ENV=test-app-w0d` completed successfully.
- At `2026-10-27T21:15:19.954Z`, API logs reported `API server listening on http://0.0.0.0:8787`.
- At `2026-10-27T21:15:20.799Z`, GET `http://127.0.0.1:8798/api/v1/health` returned HTTP 200: `status=ok`, `services.database=ok`, `readiness.status=ready`, `readiness.reasons=[]`; `/mcp` was enabled.
- `make ps` reported `test-app-w0d-api-1`, image `local/sentropic-api:pr796-w0d`, `healthy`, with port `8798->8787`.
- `make logs-api` showed successful migrations, indexes and listener startup. The isolated environment had no OAuth signing KEK; its initialization was skipped explicitly.

## Transport and MCP regression

`make test-api-endpoints SCOPE='<files below>' API_TEST_WORKERS=1 REGISTRY=local API_VERSION=pr796-w0d TARGET=development API_PORT=8798 UI_PORT=5184 MAILDEV_UI_PORT=1091 ENV=test-app-w0d` passed **85/85 tests in 7/7 files**, in 33.84 seconds:

- `api/tests/api/app-artifacts-transport.test.ts` (8)
- `api/tests/api/app-mcp-registry.test.ts` (21)
- `api/tests/api/app-mcp-installed.test.ts` (2)
- `api/tests/api/artifacts-host-credentials.test.ts` (23)
- `api/tests/api/mcp-resource-server.test.ts` (16)
- `api/tests/api/cluster-mesh-mcp-singleton.test.ts` (6)
- `api/tests/api/cluster-mesh-resources.test.ts` (9)

The transport-readiness regression awaits the same startup promise as the MCP namespace and confirms no credential binding during compilation. Exact compatibility rejects both superseded 0.2.1 and 0.2.3 receipts.

Complete local test output: `tmp/pr796/transport-mcp.log`, SHA-256 `ab4ff863ac06aabcb9d3dfa99ee73f96b765a4f0c7f602f1e2e14ac06fe9d149`. Combined build/health/state/log/cleanup output: `.tmp/pr796-runtime.log`, SHA-256 `523d6f90398d43eef6c7c6869de02379e9651b96768fe7e9905b0439287ad832`.

The runtime step finished with locked `make down ENV=test-app-w0d`; all four service containers and its network were removed. This proves development-mode API startup and the scoped suites. W3 retains qualification of the canonical pruned production image; activation remains default-closed.

`make -f Makefile -f docs/baselines/app-cm-w0/probe.mk w0-record-check API_PORT=8798 UI_PORT=5184 MAILDEV_UI_PORT=1091 ENV=test-app-w0d`, under the same lock, also passed: historical vectors (1 positive/3 negative), verifier bytes/source hashes, refreshed tuple vectors, exact source hashes, complete lock, profile/payload receipts and record links. Historical 18/26 October receipt bytes are retained. No assertion or timeout was relaxed.
