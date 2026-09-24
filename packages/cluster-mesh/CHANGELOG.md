# Changelog

## 0.11.0

- Add runtime binding availability reporting and gating for local devices and projections,
  including optional per-kind projection support and effective `localProjectionKinds`.
- Intentional type widenings: `capabilities.localDevices` and `localProjection` now
  return `'available' | 'gated'`; `GatedCapability` adds `local_devices`,
  `local_projection` and `device_denial`. Update exhaustive type checks accordingly.
- Accept a shape-checked, trusted injected NHI lifecycle, retaining the command-runner default.
- Forward optional attestation role/scope; reject empty and option-like role/scope/instance
  arguments with `InvalidNhiArgumentError` before command execution.
- Delegate optional device denial. The adapter now always exposes `denyDeviceCode`,
  although the interface remains optional; legacy ports throw
  `CapabilityGatedError('device_denial')`. Feature detection by method presence flips:
  presence no longer proves support; track the host binding or handle the gated error.
- Validate optional signed-projection timestamps on creation and resolution; add
  canonical signing bytes and opt-in strict expiry, maximum TTL and clock skew.
- Export `verifyCustodySignature` from the package root. This does not close F8,
  which requires a separate h2a-internal verify-only module.
- Document SemVer, the N/N-1 compatibility window and major/removal conformance gates.
- Preserve 0.10.1 inputs and port implementations; client-signed projections (F5) remain open.
- Add reusable h2a-facing conformance fixtures for the N/N-1 release gate.
- Migration: 0.9 → 0.11 requires the 0.10.0 adaptations (`commandId` → `commandRef`
  on the session-router wire, strict keys, mandatory custody).

## 0.10.1

- Add the signed message client with send, receive and acknowledgement helpers
  (PR #590; `85c207a2d`, `bdb0e644f`, version `cced28636`).
- Skip malformed or invalid-signature poison messages during client drain so
  valid later messages remain consumable (`056a5ec75`).

## 0.10.0

- Add bounded-local custody issuance, verification, lifecycle and trust-root ports
  (PR #586; `accf70c89`).
- Integrate M05 launch context and custody/gateway authorization into registration
  and the session router (`6fa1e2dcc`).
- Add M01 bounded-local messaging: authorization, delivery, acknowledgements,
  subscriptions, capacity/expiry handling, native drain and actuation handoff
  (`777c11f44`; version `c80a810ca`).
- Reject deferred custody actuation at the messaging handoff (`aafa965c8`).
- These historical runtime contract changes require consumer adaptation from 0.9;
  they predate the compatibility policy introduced in 0.11.0.

## 0.9.0

### Changed

- Breaking: verified invocation contexts now require custody; missing custody is
  denied with `custody_required`.
- Breaking: actuator ports require `probeState`, actuation results require
  `outcome`, and session control ports require `instructions`.
- Breaking: registration authorization now uses the `authorize(context, action)`
  signature.
- Breaking: actuation adds the contract-level `deferred` outcome. The current API
  consumer cannot store it until a future owner-gated control migration.
- Breaking: `/auth/session/control/*` bodies now require `commandRef`. A body with
  both `commandId` and `commandRef` is accepted and `commandId` is ignored; a body
  with `commandId` alone returns HTTP 400.
