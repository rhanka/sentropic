---
status: failed
reviewer-host: claude
reviewer-model: gpt-5.6-luna
reviewer-effort: xhigh
target-ref: 670560734c7acf5bed5a86059d7e92352b370273
target-diff-sha256: 2efe8fd4a8da6cc03d2c29d2130dca20849973b8708dff4b27160a33bb7749cb
lens: protocol/state machine, crypto binding, replay, and teardown ordering
---

## Findings

1. **High — lease-v2 verification does not validate the envelope schema or time fields.** `verifyLeaseV2` only checks `version`, `kid`, the signature, `expiresAt > now`, and selected expected fields. It accepts signed envelopes with missing or malformed required fields (including `leaseId`, identities, capability/authority bindings, `issuedAt`, `nonce`, and numeric epochs/budget), and it does not reject `issuedAt` in the future or enforce `expiresAt > issuedAt`. Since `storeGeneralLeaseV2` relies on this verifier before persisting, an otherwise valid server signature can authorize malformed or semantically unbounded leases. Add strict schema/type/range validation and temporal validity checks before signature acceptance/storage.

2. **High — the claimed fresh-wake protocol is not fresh-authority issuance.** `/wake` verifies a device PoP whose challenge is merely the durable call reference, then calls `requireFreshAuthorityOnWake`, which only re-writes `requiresFreshAuthority=true` on the pending row. It neither consumes a server-issued one-time challenge nor obtains a new human receipt/PEP decision, and it can be replayed indefinitely while the call remains pending. A device can therefore repeatedly “wake” the same deposit without a fresh authority event. Bind wake to a server nonce/challenge with one-time durable consumption and require the new authority/lease material (or explicitly leave wake unavailable).

3. **Medium — PoP is not consistently bound to the resource and server freshness.** Poll and SSE accept caller-supplied arbitrary challenges; there is no server challenge store, expiry, or one-time-use check. Result and wake only compare that arbitrary challenge to `callRef`. The cryptographic signature proves possession of the key, but not that the server freshly authorized this request. Implement server-issued, channel/resource-bound challenges with replay tracking and kill/epoch binding where applicable.

4. **Medium — atomic lease transitions are not a complete lifecycle invariant.** Ack updates a lease selected only by lease/device/user and verifies the stored signature, but does not require the lease to be General-pending (`issued`) until the conditional update, nor verify current device `killEpoch` against the envelope. More importantly, `consumeGeneralLease` is not called by any General route/worker in this diff, and no General issue path calls `storeGeneralLeaseV2`; the durable protocol therefore has no connected issue→ack→consume authority flow. The individual conditional updates are race-safe, but the end-to-end protocol is incomplete and cannot establish two-sided authority.

5. **Medium — revoke-before-cascade is not protected against stale concurrent operations.** Revocation increments `killEpoch` and revokes leases in one transaction, which is good ordering, but lease ack/consume/revoke/expire do not check the current device status or epoch. An ack or consume transaction racing after the revoke transaction can succeed on a lease whose signed epoch is now stale (particularly consume, which checks only lease status/expiry). Add device status/kill-epoch predicates and use the same transaction/locking boundary for lease transitions and teardown, or make every transition reject stale epochs.

6. **Low — canonicalization is only locally deterministic, not a complete cross-language canonical contract.** `canonicalJson` sorts object keys but does not define number normalization, rejects no non-finite numbers explicitly, and relies on JavaScript `JSON.stringify` behavior for escaping and floating-point serialization. The fixed envelope currently uses numbers, so a different implementation can produce a different signature for equivalent values. Use a specified canonical JSON profile (or canonical CBOR) and validate values before signing/verifying.

## Verdict

**FAILED.** The diff has useful fail-closed seams and conditional state updates, but the missing schema/time validation, replayable/non-fresh wake, absent connected issue/consume path, and stale-epoch teardown race prevent approval of lease-v2 canonicalization/ack/PoP, durable I5 transitions, fresh wake, atomicity, and revoke-before-cascade as a complete protocol.

## Remediation self-check — 2026-08-08

**Reviewed remediation commits:** `a5089b966`, `282ef0cdf`, `8ad2f71b9`, `99adf16b7`, `c5d3f4816`, `8fabfa2dc`, `14539954d`, `5daaee874`, `a983de549`, `80459abe2`, and `9b1f4ee00`.

| Defect | Re-run result | Evidence |
|---|---|---|
| C3 replayable proof / stale wake | **Implementation remediated; acceptance not closed.** | `cowork_device_proof_challenges` atomically burns a 60-second, PEP-key/device-epoch/channel/resource/method-bound challenge. SSE establishes a one-use header session by POST; no PEP signature remains in the URL. Wake consumes its proof but returns `409` and cannot return/resume authority. |
| C4 durable call / current epoch / rotation / TTL | **Implementation remediated; acceptance not closed.** | `issueGeneralLeaseV2` locks the pending durable call and active device, mints the signed envelope, persists fresh policy/receipt authority, and inserts the lease in one transaction. Ack and consume lock and re-match the complete call/device/authority tuple. Strict envelope, time, algorithm, bounded-key-overlap, and epoch validation now precede acceptance. |
| C5b revoke before cascade | **Implementation remediated; acceptance not closed.** | `0042` installs one SQL revoke function reached by `BEFORE DELETE` device and user triggers; a call-delete trigger covers workspace/user call cascades. It revokes live leases, invalidates proof material, cancels pending calls, and stores ids-only tombstone lease ids before cascade. Key/status changes also bump the device epoch and revoke pending authority. |

The new vectors in `api/tests/unit/cowork-general-lease-v2.test.ts` cover malformed/future/overlong and rotated-out leases. `api/tests/api/cowork-general-protocol.spec.ts` covers proof replay plus durable restart/reconnect, different-call and prior-epoch rejection, and device/workspace/user cascade ordering.

`make typecheck-api ENV=test-cowork-cu-general` passes. The two required scoped API commands remain blocked by the environment after both permitted API stack bootstraps: `make test-api-unit SCOPE=tests/unit/cowork-general-lease-v2.test.ts ENV=test-cowork-cu-general` and `make test-api-endpoints SCOPE=tests/api/cowork-general-protocol.spec.ts ENV=test-cowork-cu-general` both report `service "api" is not running`. Therefore no replay/race/cascade test is claimed green.

## Updated verdict

**NOT ACCEPTED YET.** The original C3/C4/C5b exploit paths are remediated in source and are covered by deterministic regressions, but their required API execution evidence is blocked. Lots 1–2 remain stopped and must not be re-ticked or merged until those suites run green. The earlier enrollment/containment observations remain later-lot fail-closed seams; no execution or auto-authority route was introduced.
