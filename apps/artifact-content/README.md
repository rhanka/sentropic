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

Grants carry no session identifier: logout or session revocation takes effect at grant expiry (at most 55 seconds), while every new activation rechecks the live session; W3.e must assert this bound alongside immediate membership, ACL and lifecycle revocation.

## Qualification

Use the existing Make targets with the shared Docker lock, ports `API_PORT=8803 UI_PORT=5189 MAILDEV_UI_PORT=1096` and `ENV=test-app-w3b` last:

- `make up-api-test ... ENV=test-app-w3b`
- `make test-api-endpoints SCOPE=apps/artifact-content/tests API_TEST_ARGS="--config ../apps/artifact-content/vitest.config.ts --no-file-parallelism" ... ENV=test-app-w3b`
- `make exec-api CMD="npx --no-install tsc --project ../apps/artifact-content/tsconfig.json" ... ENV=test-app-w3b`
- `make down ENV=test-app-w3b`

The runtime suite creates and drops its own random PostgreSQL database. It imports the unchanged W3.a activation service and real package PG ports. These local checks do not qualify a production image, live ingress or browser bridge.

## Live edge (A-LIVE §8.2, W9)

Off unless `APP_ARTIFACT_LIVE_ENABLED=1` and content serving are both enabled. An incomplete or inconsistent configuration then refuses startup:

- `APP_ARTIFACT_LIVE_PAGES_DOMAINS` (ConfigMap, per environment): whitespace-separated `<pages domain>=<kid>[,<kid>...]`. Preprod: `pages.preprod.immo.sent-tech.ca=immo-preprod-live-1` with controller kid `sentropic-preprod-live-1`. Prod: placeholders `pages.immo.sent-tech.ca=immo-prod-live-1` with controller kid `sentropic-prod-live-1`, inert until immo serves the prod pages domain and both rings are minted. A pages domain never overlaps the content base domain or another pages domain, and serves live routes only.
- `APP_ARTIFACT_LIVE_HOST_KEYS` (Secret `artifact-content-runtime`): whitespace-separated `<kid>=<unpadded base64url>`, at least 32 bytes each. The immo content host holds the same keys and signs the assertion (`v1`) and its revocations (`c1`).
- `APP_ARTIFACT_LIVE_CONTROLLER_KEY_IDS` (ConfigMap) and `APP_ARTIFACT_LIVE_CONTROLLER_KEYS` (Secret): the Sentropic API controller ring for fences (`f1`). Its kids and bytes differ from every host key, so immo can never forge a fence.
- Optional: `APP_ARTIFACT_LIVE_BUILDER_NAMESPACE` (default `sentropic-artifact-builders`) and `APP_ARTIFACT_LIVE_PEERS` (multi-replica only, see below).

The wire format is imported from `@sentropic/artifacts/live-host` (0.2.20+): immo, the API and this edge sign and verify with that one module. `sourceRevision` is an opaque string of 1 to 256 characters, compared and never parsed.

Push paths. Each takes exactly one signed header, no query and no body. 204 means applied; any other answer means retry (every operation is idempotent and only tightens authority). A message lives at most 300 s.
- Host (immo): `POST /_live-control/v1` on the artifact's own pages-domain Host, `x-live-host-control`: `revoke_session`, or `revoke_invitation` with the new epoch floor. Open sockets close at once.
- Controller (Sentropic API): `POST /_live-fence/v1` on the internal service Host (`artifact-content.<namespace>.svc.cluster.local:8791`), `x-live-controller-fence`: the artifact's generation and route-epoch floor. Refused on every public content or pages host.

Edge admission forwards Vite dev URL shapes only (`/`, `/index.html`, `/src/`, Vite client and virtual modules, `/node_modules/`, root static files); the pod's Vite serves the staged closure only.

Replicas. Fence state is in memory per replica; every overlay runs one replica. Before scaling above one, add a headless Service over the `artifact-content` pods, set `APP_ARTIFACT_LIVE_PEERS` to its DNS name, and allow ingress from `artifact-content` to itself on 8791. The receiving replica then copies every accepted push, with its original signature, to each ready replica (itself included) and answers 204 only when all applied it, else 503. A relayed copy (`x-live-relayed: 1`) is accepted only from the socket address of a ready replica (the resolved `APP_ARTIFACT_LIVE_PEERS` set), never on the word of a header; without peers none is accepted. A replica that becomes ready later holds no earlier fence but no earlier socket either; immo's gate stops asserting revoked sessions and invitations, and the immo content host closes its own proxied sockets on revocation.

Key rotation, for either ring (keys are read at startup):
1. Mint at least 32 random bytes under a new kid. Record it by name in the owner `.env` and in the Secret, never in source, logs or receipts.
2. Add the new `<kid>=` entry to the Secret and the new kid to the ConfigMap list, keeping the old kid. Roll out `artifact-content`.
3. Switch the signer (immo content host for host keys, Sentropic API for controller keys) to the new kid.
4. After the longest message lifetime plus skew (3630 s host, 330 s controller), remove the old kid from the ConfigMap and the Secret. Roll out.
Rotate at least every 90 days, and at once on suspected exposure.

## Supervisor relay (A-LIVE §8.1)

artifact-content is the workers' only ingress, so every supervisor frame from the API rides `POST /_live-supervisor/v1/<podName>` on the internal Service Host (`artifact-content.<namespace>.svc.cluster.local:8791`). Public content and pages hosts answer 404. The listener mounts the route ahead of content serving, so it is off unless `APP_ARTIFACT_SUPERVISOR_RELAY_ENABLED=1`, independent of `APP_ARTIFACT_CONTENT_ENABLED` and `APP_ARTIFACT_LIVE_ENABLED`.

- `APP_ARTIFACT_SUPERVISOR_PUBLIC_KEYS` (ConfigMap, public): whitespace-separated Ed25519 SPKI DER base64, the `supervisorPublicKey` of the key in the API's `ARTIFACT_SUPERVISOR_SIGNING_KEY_JSON`; two entries during a rotation. No new secret: the private key stays in the API.
- `APP_ARTIFACT_LIVE_BUILDER_NAMESPACE` (default `sentropic-artifact-builders`) names the pods' Service namespace.

Before the pod is touched: pod name `artifact-<40 hex>`, `application/octet-stream`, 65 bytes to 2 MiB (413 otherwise), a W3 frame verified with a configured key whose fence names the same pod (else an empty 403). The same bytes go to `http://<podName>.<namespace>.svc.cluster.local:5173/_supervisor/v1/frame` with no other header, over node:http (no undici headers timeout) bounded at 330 s, aborted when the API client closes. No queue; concurrent frames per pod are allowed. Pod 200 gives 200 with its body (over 2 MiB gives 502), pod 403 gives 403, anything else 502. Nothing about a frame is logged. The API side (`ARTIFACT_SUPERVISOR_RELAY_URL`) bounds each command at 320 s.

## Execution-node data plane (S1-C1)

`APP_ARTIFACT_SANDBOX_BACKEND=k8s` is the default and retains the existing pod HTTP/HMR and supervisor relay. Select `execution-node` to use the data-plane transport for both. Unknown selections refuse startup; an unavailable execution node never silently falls back to k8s. Returning the selector to `k8s` is the hot rollback.

Execution-node configuration (names only):

- `SANDBOX_NODE_URL`: HTTPS origin, no userinfo, path, query or fragment.
- `SANDBOX_MTLS_DATA_PLANE_CERT_B64`: PEM client certificate, base64; CN `data-plane:artifact-content`.
- `SANDBOX_MTLS_DATA_PLANE_KEY_B64`: its PEM private key, base64.
- `SANDBOX_MTLS_CA_CERT_B64`: PEM CA certificate, base64.

Only the data-plane pair is loaded. TLS 1.3, server hostname/CA verification and client authentication are mandatory. No credential values or frame/token contents are logged. No signing key or control-plane credentials belong here.

The composing host must supply `startContentServer({ custodyIssuer })` in execution-node mode. The standalone entry point deliberately refuses that mode until S1-B0a supplies this dependency. The exported `CustodyIssuer` interface in `src/data-plane.ts` is the integration contract:

- `issue(subject, signal)` resolves an authenticated live route (`kind: live`, full `LiveRoute`) or a verified supervisor target (`kind: supervisor`, deterministic `podName`) to its current tenant, principal, physical UID, custody epoch and sandbox port. It must recheck host/session/resource authority; a pod name alone never grants authority. Resolve the subject against API-owned state, never browser headers. Observe the abort signal.
- Return `{tenantId, principalId, physicalUid, custodyEpoch, port, token, issuedAt, deadlineAt}`. `token` is the exact agent-verifiable signed `X-Custody-Token`; the edge treats its encoding as opaque. Its signed claims must match that metadata, with `resourceId=physicalUid`, ISO timestamps and TTL at most 60 seconds. S1-B0a owns wire encoding/signature agreement with the agent; this lane adds no competing token codec.
- `watch(subject, revoke)` subscribes before issuance and immediately notifies on revoked custody or any resolved binding/tenant/principal/physical-UID change. Return an unsubscribe function. Do not allow a renewal to authorize a subject revoked in the meantime.

Every new HTTP hop and WS handshake obtains fresh custody. The edge sends only its allowlisted application headers plus `X-Tenant-Id`, `X-Expected-Physical-Uid`, `X-Custody-Token` to `/v1/ports/:port/<original path and query>`. Browser cookies, Authorization and caller-supplied custody headers are never forwarded. Supervisor frames still pass the existing signature/fence checks before any custody is issued.

HTTP is buffered within the existing size bound and the original token deadline. Expiry, issuer revocation or upstream 403 before response release returns `403 {"error":"custody_revoked"}` without upstream content. Custody remains active through live-response transformation and delivery under backpressure; after headers have been released, expiry/revocation terminates the body stream. An active WS is never extended beyond the token admitted at its handshake: close with 1008 on revocation and proactively before its deadline (20% of TTL, capped at one second). A reconnect through the same authorization path obtains fresh custody. This explicit reconnect avoids inventing an agent-side in-band token update protocol; automatic Vite/browser reconnection remains a browser qualification prerequisite. The agent independently enforces expiry and minCustodyEpoch; its 1008 frame passes through the tunnel.

Agent integration prerequisite: the baseline `apps/sandbox-node/src/service.ts` does not yet serve `/v1/ports/:port/*` or verify signed custody tokens. The agent owner must implement that contract before enabling this backend. Local tests use an ephemeral mTLS fake and a separate fake signing/verifying issuer; they do not qualify the VM or an agent token wire format.

## Live CSP D7-A

`APP_ARTIFACT_LIVE_CSP_PROFILE=default` (or unset) retains `worker-src 'none'`. The pre-authorized `D7-A` profile changes only that directive to `worker-src 'self' blob:`. Invalid profiles refuse live-edge startup. D7-A also admits Vite's `?worker&url` form for MapLibre and its generated `?worker_file&type=module|classic` entry, through the host path allowlist; the default profile rejects both. All other isolation, request authorization and response headers stay in force.
