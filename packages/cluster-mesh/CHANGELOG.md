# Changelog

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
