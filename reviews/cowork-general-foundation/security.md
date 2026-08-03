---
status: failed
reviewer-host: claude
reviewer-model: gpt-5.6-sol
reviewer-effort: xhigh
target-ref: 670560734c7acf5bed5a86059d7e92352b370273
target-diff-sha256: 2efe8fd4a8da6cc03d2c29d2130dca20849973b8708dff4b27160a33bb7749cb
lens: security invariants, authority boundaries, and cross-tenant disclosure
---

# Security review

## Verdict

**FAILED.** The diff is fail-closed in the narrow sense that it adds no input executor and has no `FAIT` writer, and its connector-host principal/tenant/workspace checks are directionally sound. However, the claimed Lots 1–2 foundation does not establish C3/C4/C5b or durable two-sided authority safely. Device proof is replayable, lease verification is not tied to current durable authority, retired server keys remain valid without a bounded overlap, and revoke-before-cascade is an unused helper rather than an enforced deletion invariant.

These are release-blocking protocol defects even though the current code has no execution path: later lots would naturally consume these primitives as authorization foundations.

## Findings

### S1 — High — C3 device proof is a reusable bearer, not a fresh resource-bound proof

**Evidence:** `api/src/services/cowork/lease-v2.ts:81-89`, `api/src/routes/api/chrome-extension.ts:205-243`, `api/src/routes/api/streams.ts:342-365`.

`DevicePepProof` signs only `{channel, deviceId, pepKeyId, challenge}`. The server does not issue the challenge, record it, impose an expiry, or consume it. For poll and SSE, the client chooses any challenge, so one captured signature can be replayed indefinitely with a stolen bearer. Wake/result merely require `challenge === callRef`, which makes the proof a permanent signature for that call rather than a fresh proof. Ack does not bind its outer proof challenge to `leaseId` at all.

The SSE variant additionally puts the proof signature and challenge in the query string, exposing a replayable credential to common URL/proxy/access logs. Channel separation prevents using a poll proof as a result proof, but does not provide freshness or one-use/resource binding within a channel.

This violates C3/D7 and does not defend against the explicitly characterized stolen-bearer threat.

**Required remediation:** use a server-minted, short-lived, one-use challenge bound to authenticated user, exact route/resource id, method, channel, device/PEP key, and preferably a server nonce/issued-at. Atomically consume it. Do not transport proof signatures in SSE URLs; use an authenticated proof-establishment exchange or another header/body-capable mechanism. Add replay, expiry, wrong-resource, and URL-disclosure tests for every channel.

### S2 — High — Lease v2 is not bound to the durable call, tenancy, current device epoch, or active authority

**Evidence:** `api/src/services/cowork/general-lease-service.ts:16-33`, `api/src/services/cowork/general-lease-service.ts:37-54`, `api/src/services/cowork/lease-v2.ts:50-64`.

`storeGeneralLeaseV2` verifies the signature, principal, target device, and PEP key id, but does not load and match `durableCallRef` against `cowork_general_calls`. It therefore does not establish that tenant, workspace, invocation, tool call, descriptor id/digest, target, or authority epoch match the committed call. Although `verifyLeaseV2` supports expected tenant/workspace fields, the store does not supply them. It also does not compare the envelope's `killEpoch` with the device row or require the General containment profile/presence.

Acknowledgement verifies the signed envelope digest but trusts a caller-supplied PEP public key at the service boundary and then updates only by lease id/status/expiry. It does not transactionally recheck active device status, current PEP key id/key, or current `killEpoch`; key rotation/revocation can race the select and update. Consumption similarly checks only lease id, device id, status, and expiry, with no user, durable call, active-device, kill-epoch, receipt/scope, or current-policy check.

Consequently C4's cryptographic tuple is signed but is not connected to the database authority it purports to represent. This falls short of C4/D6/D8 and BC-2/BC-3.

**Required remediation:** issue/store/ack/consume inside transactions that lock and join the durable call and active device. Match the complete security tuple (principal, tenant, workspace, invocation/tool call, durable ref, target/PEP key, descriptor digest, policy/authority/kill epochs, nonce, expiry), source the PEP key from that locked row, and condition every transition on current epochs and active status. Keep result acceptance bound to the same tuple. Add cross-tenant/workspace/durable-ref substitution and revoke/key-rotation race tests.

### S3 — High — Server key rotation has unlimited verification overlap, and lease lifetime is unbounded

**Evidence:** `api/src/services/cowork/lease-v2.ts:50-64`, `api/src/services/auth/jwks-adapter.ts:50-57`, `api/src/services/cowork/general-lease-service.ts:27-30`.

Lease verification accepts any `kid` returned by `findKeyByKid`. That adapter returns inactive/rotated records without evaluating `active`, `rotatedAt`, an overlap deadline, revocation, algorithm, or intended key use. In parallel, verification checks only `expiresAt > now`; it does not reject future `issuedAt`, `expiresAt <= issuedAt`, or a TTL above the protocol's short-lived maximum.

Thus a retired key remains a valid Cowork lease verifier indefinitely, and possession of an old private key can produce arbitrarily long-lived General leases. The comment that retired keys merely have an overlap is not implemented. This violates D6's key-status/rotation and short-expiry requirements.

**Required remediation:** define and enforce a bounded retired-key verification window, explicit revocation, Ed25519/EdDSA key metadata/use, sane `issuedAt`, and a strict maximum lease TTL. Key acceptance and time checks must use one authoritative clock. Test just-inside/just-outside rotation overlap, revoked keys, future issuance, inverted time ranges, and overlong TTLs.

### S4 — High — C5b revoke-before-cascade is not enforced by any deletion path

**Evidence:** `api/src/services/cowork/general-call-service.ts:65-78`, `api/drizzle/0042_cowork_general_foundation.sql:9-35`; repository search finds no production caller of `revokeCoworkDeviceBeforeCascade`.

The diff adds a reasonable transactional helper, but nothing routes device/user/workspace deletion through it. Existing device ownership still cascades from users, and leases/presence still cascade from devices. A direct or parent cascade therefore bypasses the helper and can erase authority records without first latching the kill epoch, cancelling calls, revoking leases, or writing a tombstone.

The tombstone also has a non-cascading foreign key to `users`, so it cannot both survive user deletion and permit that deletion as designed. This is an unenforced convention, not the C5b invariant.

**Required remediation:** make all device and parent teardown entry points invoke one locked revoke/outbox path before deletion, or enforce equivalent ordering at the database/job boundary. Ensure tombstones survive parent deletion (ids-only, without a blocking parent FK), and prohibit hard deletion while non-terminal authority remains. Test direct device deletion and user/workspace cascades, including concurrent issue/ack/consume.

### S5 — Medium — The General lease/device enrollment path is disconnected, leaving unreviewed trust insertion as a future authority bypass

**Evidence:** new General fields in `api/drizzle/0042_cowork_general_foundation.sql:2-5`; repository search finds no production writer for `pep_public_key`, `pep_key_id`, or `general_profile`, and no production caller of `signLeaseV2`, `storeGeneralLeaseV2`, `depositGeneralCall`, or `createCoworkGeneralBrokerFactory`.

Tests populate PEP identity and containment metadata directly. No authenticated enrollment/rotation procedure proves possession of a distinct PEP key, binds `pepKeyId` to that key, or establishes who is authorized to assert `isolatedVmTarget` and `egressPolicyRef`. Likewise, the broker, durable deposit, signer, and lease store are isolated primitives rather than one authority path.

This is currently fail-closed because real rows are not populated and no execution exists, but it does not complete C1–C5b as claimed. A later ad hoc writer would become a critical authority boundary without this review's guarantees.

**Required remediation:** define the trusted enrollment/profile authority and key-rotation/revocation flow now, with PoP and immutable/audited profile assignment, or explicitly mark the lot incomplete and keep the APIs unreachable. Integrate the broker-to-deposit-to-fresh-lease path before treating these primitives as a security foundation.

### S6 — Medium — Containment and egress are self-asserted metadata, not BC-5 proof

**Evidence:** `api/src/services/cowork/general-call-service.ts:14-20`, `api/src/services/cowork/general-device-proof.ts:16-24`, `api/src/services/cowork/general-action-safety.ts:49-62`.

The gates accept `general_profile.isolatedVmTarget === true` and any non-empty `egressPolicyRef`; they do not verify a signed attestation, current image/profile measurement, or enforcement state. `nodeEnv === 'production'` blocks production but does not establish isolation or deny host/dev/test infrastructure in other environments. This is a useful fail-closed seam only if it is not represented as containment enforcement.

**Required remediation:** keep all execution unreachable until a trusted containment/egress authority supplies signed, fresh, target-bound evidence and the server verifies it. Name metadata fields as assertions rather than verification, and add stale/wrong-target/unsigned policy tests when BC-5 is implemented.

## Positive observations

- D2 is handled conservatively in the current broker: model input is not passed to descriptor, target, receipt, policy, or PEP decisions (`general-broker-service.ts`). Unknown and sensitive classes require a fresh receipt, and the foundation cannot return `FAIT`.
- The connector adapter checks trusted invocation principal/tenant/workspace against the resolved request and returns deny-as-missing on mismatch. Shared connector mount state does not contain per-call action state.
- Durable call listing is scoped by authenticated principal and exact device, and wake/result additionally match call ownership/target. No descriptor ciphertext or screen/model content is returned by those routes.
- Lease and ack signatures cover canonical complete envelopes/digests, reject v1 at the General service seam, and use domain-separated payloads. Conditional status updates provide useful one-winner transition mechanics.
- The current diff introduces no raw input executor, no automatic action path, and no `FAIT` writer. Ambiguous result reports resolve to `PAS-FAIT`.

## Review scope

Reviewed target diff `d7ec18180..670560734` for D2, C1–C5b, BC-2/BC-3/BC-5, tenancy/device proof, and cryptographic safety. This was a blind code review; no product code was changed and no test result is claimed.
