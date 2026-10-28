# Sentropic artifact content process (W3.b)

This internal HTTP listener adapts the published artifacts 0.2.4 content ports. It has no publication commands, migration executor, background jobs or public blob endpoint. W3.c builds it into the canonical image; W3.d supplies the isolated ingress and credentials; W3.e qualifies actual TLS and browser behavior after FIRST-IMMO. All serving is default-closed.

## Configuration

`APP_ARTIFACT_CONTENT_ENABLED=1` requires `DATABASE_URL`, `APP_ARTIFACT_CONTENT_BASE_DOMAIN`, `APP_ARTIFACT_CONTENT_SIGNING_KEY_FILE` and dedicated `APP_ARTIFACT_S3_{BUCKET,REGION,ACCESS_KEY_ID,SECRET_ACCESS_KEY}`. `APP_ARTIFACT_S3_ENDPOINT` is optional. The key file contains at least 32 secret bytes and is reread for every grant operation; atomically replacing it invalidates previous grants across processes. Grant lifetime is the upstream 55 seconds. Never store the key in source, receipts or logs.

The database role reads app authority/publication tables and uses the existing W1.c activation tables through W3.a. It does not run migrations. The S3 role needs private bucket access-block inspection and object reads only. The existing private-storage adapter checks all four public-access blocks; absent or unsupported checks refuse startup. No public URLs, listing, object mutation or document-storage credentials are used.

`ARTIFACT_CONTENT_PORT` defaults to 8791. `/healthz` is a credential-free liveness check. The listener is cleartext **inside the dedicated network boundary only**; the W3.d ingress terminates TLS and preserves the original Host. Forwarded host, protocol and subject headers convey no authority. Expose only approved stable UUID hosts and release UUID `.pinned` hosts, at standard HTTPS port 443. Infrastructure must exclude direct public access to the cleartext listener.

## Reader transport

The content-origin browser bridge obtains a 32-byte nonce with `GET /_reader/nonce`, receiving JSON and a Secure, HttpOnly, host-only `__Host-artifacts_nonce` cookie (Strict, 60 seconds). It conveys the nonce to the trusted app UI through that UI's explicit browser bridge. This service emits no CORS permission. W4.c owns the browser UI/bridge; W3.e owns its cross-browser acceptance.

The existing authenticated app reader-activation port issues a flow for the exact content origin and nonce. The content-origin bridge posts **only** `{flowId,ticketId}` to `/_reader/activate` with exact same Origin, JSON Content-Type, `X-Artifact-Activation: 1` and its nonce cookie. The runtime resolves subject/session/workspace from durable issuing state, then W3.a atomically rechecks current authority and consumes the flow/ticket. Only an acknowledged consume sets the upstream host-only grant cookie. Replay, expiry, wrong browser, revoked session and uncertain commit yield no cookie. Both reader endpoints additionally require `APP_ARTIFACT_READER_ENABLED=1` in the standalone process.

Every private read verifies the current key and short grant, current account/tenant/workspace membership, release state and ACL/lifecycle. These checks repeat after blob waits; stable pointer movement requires fresh consent. Pinned origins retain their exact release. All assets use upstream isolation headers and no-store; direct storage keys never route.

## Qualification

Use the existing Make targets with the shared Docker lock, ports `API_PORT=8803 UI_PORT=5189 MAILDEV_UI_PORT=1096` and `ENV=test-app-w3b` last:

- `make up-api-test ... ENV=test-app-w3b`
- `make test-api-endpoints SCOPE=apps/artifact-content/tests API_TEST_ARGS="--config ../apps/artifact-content/vitest.config.ts --no-file-parallelism" ... ENV=test-app-w3b`
- `make exec-api CMD="npm exec -- tsc --project ../apps/artifact-content/tsconfig.json" ... ENV=test-app-w3b`
- `make down ENV=test-app-w3b`

The runtime suite creates and drops its own random PostgreSQL database. It imports the unchanged W3.a activation service and real package PG ports. These local checks do not qualify a production image, live ingress or browser bridge.
