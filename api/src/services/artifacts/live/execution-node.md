# Execution node API adapter (S1-B0a)

`SandboxBackend` is the runtime port boundary of the existing live controller.
`ARTIFACT_SANDBOX_BACKEND=kubernetes` (the default) preserves the existing pool,
supervisor, admission and cache composition. `execution-node` selects the node
backend explicitly. It never silently falls back after a node refusal.

`createExecutionNodeBackend` is composed by default for the selected node.
`ProductBuilderDeps.executionNodeInputs` supplies sealed-base/session
registry inputs. Without those inputs, allocation refuses before creating a sandbox.
S1-B1 supplies authenticated tenant binding, registry-resolved
devScope, base hydration and the candidate/publication bridge. The adapter alone
does not qualify Focus live or publish, and is not an activation instruction.

The backend implements the controller's pods, worker, cache, heavy and admission
ports. Existing `/v1/live/*` and `/v1/builds` routes keep their host authorization,
durable state, draft fencing and SG4 publication. S1-B1 must invoke the stateless
source provider through `ExecutionNodeInputs.forge/source/tenant`; the composition
applies head coalescing and the tenant queue. The node's cross-replica
AdmissionLedger remains authoritative.

## Preprod Secret names

No values belong in this document or a lane report.

- `ARTIFACT_SANDBOX_BACKEND`
- `ARTIFACT_EXECUTION_NODE_URL` (HTTPS root URL)
- `ARTIFACT_EXECUTION_NODE_ID`
- `ARTIFACT_EXECUTION_NODE_INSTANCE_ID` (operator-approved instance)
- `ARTIFACT_EXECUTION_NODE_EPOCH` (operator-approved positive epoch)
- `ARTIFACT_EXECUTION_NODE_PROVENANCE_PUBLIC_KEY_B64` (base64 SPKI PEM)
- `ARTIFACT_EXECUTION_TICKET_ED25519_KEY_B64` (base64 Ed25519 PKCS#8 PEM)
- `SANDBOX_MTLS_CA_CERT_B64`
- `SANDBOX_MTLS_CONTROL_PLANE_CERT_B64` (CN `control-plane:sentropic-api`)
- `SANDBOX_MTLS_CONTROL_PLANE_KEY_B64`
- `SANDBOX_S3_SENTROPIC_ACCESS_KEY_ID`
- `SANDBOX_S3_SENTROPIC_SECRET_ACCESS_KEY`
- `SANDBOX_S3_SENTROPIC_BUCKET`
- `SANDBOX_S3_SENTROPIC_ENDPOINT`
- `SANDBOX_S3_SENTROPIC_PREFIX`
- `SANDBOX_S3_SENTROPIC_REGION`
- `SANDBOX_S3_SENTROPIC_USERID` (operator metadata, not used in signing)
- `SANDBOX_S3_IMMO_ACCESS_KEY_ID`
- `SANDBOX_S3_IMMO_SECRET_ACCESS_KEY`
- `SANDBOX_S3_IMMO_BUCKET`
- `SANDBOX_S3_IMMO_ENDPOINT`
- `SANDBOX_S3_IMMO_PREFIX`
- `SANDBOX_S3_IMMO_REGION`
- `SANDBOX_S3_IMMO_USERID` (operator metadata, not used in signing)

The conductor supplies the registered public key for instance
`7c710995-cfa9-4e2f-8cad-61706f83d933` from the operator handoff.
The SPKI DER fingerprint is pinned in configuration validation:
`74b5cd02287bead58bf4e27948dc7e2150d80ca5a20924d289325b95f6bc4aaa`.
No node identity
or epoch is discovered and adopted automatically. S3 prefixes are exactly
`tenants/<tenant>/<environment>/`; keys never leave the API. Data-plane mTLS
credentials belong to S1-C1, not this client.

## Heartbeat and custody

The product scheduler starts one heartbeat loop per process. A dedicated Postgres
connection holds a node-specific advisory lock, selecting one replica to inspect
the pinned identity and send `/v1/node/heartbeat` once per second without a tenant
header. DB session loss stops that leader; identity mismatch stops and alarms.
Pool acquisition and queries are bounded at 300 ms, node calls at 500 ms. Failure
destroys the DB session and aborts any outstanding heartbeat request; stop is
bounded too. Late pool acquisitions are destroyed without acquiring the lock.
The agent independently refuses mutations after five seconds without a heartbeat.

`issueNodeCustody(node, session, principalId, minCustodyEpoch, ttlMs, now)` is the
S1-C1 issuing function. Its result contains `claims` and `headers`: a compact
EdDSA JWS in `X-Custody-Token`, plus `X-Tenant-Id` and
`X-Expected-Physical-Uid`. Claims are exactly tenantId, principalId, custodyEpoch,
resourceId, issuedAt and deadlineAt; TTL is positive and at most 60 seconds.
The caller authenticates the principal and reads authoritative ownership and
revocation floor before every issue. `revokeNodeCustody` requires monotone epochs
and returns the acknowledged ownership; persist it before issuing another token.

## Custody RPC

Live subjects use the controller's owner/invitee read policy, including the current
invitation fence and expiry on every issue/watch and again after node I/O.
The custody `principalId` identifies the sandbox owner, including for an authorized
guest: it is an API-delegated resource capability, not the viewer identity. The agent
retains its strict owner check. Watch versions contain authority fields only;
access timestamps and row counters never revoke streams.

Internal API endpoint: `POST /api/v1/artifacts/builder/v1/custody/{issue,watch}`.
Reuse the environment's API/controller ↔ artifact-content HMAC service key:
`ARTIFACT_LIVE_CONTROLLER_KEY` in API, the matching
`APP_ARTIFACT_LIVE_CONTROLLER_KEYS` entry in artifact-content. Private Ed25519
material stays exclusively in API. Serve this path on the internal service only.
The RPC authenticates before parsing/resolving authority; it does not accept a
browser bearer, pod name, tenant header or execution ticket as authorization.

Request JSON is `{subject}`. Subject is exactly the C1 `CustodySubject`:
`{kind:'live',route:LiveRoute}` or `{kind:'supervisor',podName:string}`.
Authenticate its **exact UTF-8 body bytes** using header `X-Custody-Rpc`:
`kid:timestamp:mac`, timestamp = decimal Unix milliseconds, skew at most 5000 ms,
mac = unpadded base64url HMAC-SHA256 of
`custody-rpc.v1\nPOST\n<pathname>\n<timestamp>\n<sha256hex(body)>`.
Use a fresh timestamp on every poll; requests are read-only and safely replayable
within the skew bound. `pathname` includes the complete path above. No query.
Both endpoints return `Cache-Control: private, no-store`. Bodies are bounded at
16 KiB. Errors contain closed codes only: 400 `invalid_request`, 403
`custody_revoked`, 503 `custody_unavailable`; never token/key/request details.

`issue` returns JSON
`{tenantId,principalId,physicalUid,custodyEpoch,port,token,issuedAt,deadlineAt}`.
Times are ISO-8601, TTL <=60000 ms, token is compact three-segment EdDSA JWS
with exactly tenantId, principalId, custodyEpoch, resourceId (=physicalUid),
issuedAt, deadlineAt. API resolves the current live runtime, persisted node
allocation and agent ownership/revocation floor before signing. Live route
session/generation/routeEpoch/podUid/sourceRevision/principal and expiry must
match current authority; supervisor podName is only a lookup into current
active runtime state, never a grant. Port is API-owned: 5173 for live and the
existing multiplexed supervisor service. Unknown, inactive, replaced, revoked
or unowned subjects refuse issuance.

`watch` returns `{version}` after the same authoritative resolution, without
issuing a token. Version is a SHA-256 fence over the subject's current identity,
ownership and port. All artifact-content replicas independently poll every
250 ms while they hold attached streams. Establish watch before issue; compare
the version before and after issuance. A changed version, non-200, unavailable
RPC, or request exceeding 500 ms invokes `revoke()` and closes local HTTP/WS;
an active stream must never survive loss of watch. Unsubscribe cancels its poll.
This watch-poll choice reaches every replica without an ephemeral in-process
subscriber list, external broker or durable fan-out delivery race. Agent-local
expiry and persisted minCustodyEpoch independently cut attached streams.

## Wire compatibility and S1-B1 handoff

The shipped agent uses `/v1/sandboxes/:id/export`, returning gzip bytes with a
signed node/epoch/tenant/archive hash. `exportRetainedBuild` verifies that JWS,
uploads through the control-plane presigned PUT URL, then deletes the sandbox.
Failed upload preserves retained output. A stopping response is an explicit
retryable refusal, never permission to export. The backend persists command ids,
durable destination, upload confirmation and candidate result. Short-lived upload
authorization is obtained afresh through `exportOptions.authorizeUpload` for
each PUT and never enters the agent's idempotency body. Controller reconciliation
continues BUILDING/VERIFYING after an API restart without starting the build again;
lost DELETE responses reconcile against the uploaded checkpoint and node status.
Creation and revocation intents are persisted before remote mutations; a lost
response is reconciled against that exact intent. Clean build/wake replaces a
stopped physical sandbox and persists a new route fence before worker commands.

The updated agent returns archive bytes to the API and signs their physical UID,
attemptId, buildId, command argv and devScope source, tenant, node identity/epoch
and hash. The consumer requires these expected fields before upload. The archive
also includes authenticated sandbox GET, stop-202 progression and custody-enforced
HTTP/WS. k8s must qualify/install the digest-pinned archive before G-A, including
real runsc stream-mode forwarding. No complete ArtifactProvenanceV1 runtime/base
measurement qualification is claimed by these hermetic tests.
