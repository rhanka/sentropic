// Runtime brand for SessionRelayLaneClientV1. This module is deliberately NOT
// re-exported from the packed entry point (src/sessions/relay.ts): consumers of
// the packed package can check a client with isSessionRelayLaneClient but can
// never mint one — a clientRef string or deserialized JSON never carries the
// symbol. Only trusted host composition inside mesh creates branded clients.
export const SESSION_RELAY_LANE_CLIENT_BRAND: unique symbol = Symbol('sentropic:SessionRelayLaneClientV1');
