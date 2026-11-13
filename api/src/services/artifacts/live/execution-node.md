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
The agent independently refuses mutations after five seconds without a heartbeat.

`issueNodeCustody(node, session, principalId, minCustodyEpoch, ttlMs, now)` is the
S1-C1 issuing function. Its result contains `claims` and `headers`: a compact
EdDSA JWS in `X-Custody-Token`, plus `X-Tenant-Id` and
`X-Expected-Physical-Uid`. Claims are exactly tenantId, principalId, custodyEpoch,
resourceId, issuedAt and deadlineAt; TTL is positive and at most 60 seconds.
The caller authenticates the principal and reads authoritative ownership and
revocation floor before every issue. `revokeNodeCustody` requires monotone epochs
and returns the acknowledged ownership; persist it before issuing another token.

## Wire compatibility and S1-B1 handoff

The shipped agent uses `/v1/sandboxes/:id/export`, returning gzip bytes with a
signed node/epoch/tenant/archive hash. `exportRetainedBuild` verifies that JWS,
uploads through the control-plane presigned PUT URL, then deletes the sandbox.
Failed upload preserves retained output. A stopping response is an explicit
retryable refusal, never permission to export. Persist all command ids and URL
with the intent so retries keep identical method/path/body triples.
Creation and revocation intents are persisted before remote mutations; a lost
response is reconciled against that exact intent. Clean build/wake replaces a
stopped physical sandbox and persists a new route fence before worker commands.

The shipped agent does not upload the supplied URL or emit the full frozen
ArtifactProvenanceV1. BRB0A-EX2 adds its frozen sandbox GET for lifecycle retries;
k8s must release and deploy an updated agent (GET and 202-stop progression)
before enabling this backend.
Base GET and full provenance are agent-lane handoffs before complete status
reconciliation or the full provenance/publication gate; no complete
ArtifactProvenanceV1 qualification is claimed here.
