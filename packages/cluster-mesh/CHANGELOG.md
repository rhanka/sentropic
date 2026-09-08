# Changelog

## 0.9.0

### Changed

- Breaking: `/auth/session/control/*` bodies now require `commandRef`; the legacy
  `commandId` field is rejected with HTTP 400 so direct callers fail closed and
  re-read the updated effect-semantics contract.
