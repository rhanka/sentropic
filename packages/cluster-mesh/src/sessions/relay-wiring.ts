// INTERNAL mesh-wiring seam — NOT part of the packed public surface (this
// module is not re-exported from src/sessions/relay.ts and has no package.json
// exports entry). It states what stays inside mesh (contract §8 / L-2): the
// installation/workload signers, endpoint registry, TLS/SPKI pins, DEP-FED
// grant resolution and the socket/HTTP-2 factories. Trusted host composition
// never supplies sockets, URLs, grants, prefixes or keys per call; mesh compose
// code registers the wiring once, tests register fakes. With no wiring
// registered (DEP-FED source-gap), every live route stays DISABLED and the
// connector fails closed with relay_grant_unavailable.
import type { RelayError } from './registry-types.js';
import type {
  SessionRelayConnectParametersV1,
  SessionRelayLaneClientV1,
} from './relay-types.js';

export interface SessionRelayMeshWiringV1 {
  readonly endpointRegistry: unknown;
  readonly installationSigner: unknown;
  readonly grantResolver: unknown;
  readonly tlsPins: unknown;
  readonly connect: (parameters: SessionRelayConnectParametersV1, signal: AbortSignal | undefined) => Promise<
    | { readonly status: 'connected'; readonly clientRef: string; readonly sessionRef: SessionRelayConnectParametersV1['sessionRef']; readonly stage: SessionRelayConnectParametersV1['stage']; readonly lanes: readonly string[]; readonly descriptorDigest: string; readonly client: SessionRelayLaneClientV1 }
    | { readonly status: 'refused'; readonly error: RelayError }
  >;
}

let currentWiring: SessionRelayMeshWiringV1 | null = null;

/** Internal only: mesh compose code (or tests, with fakes) registers the wiring. */
export function registerSessionRelayMeshWiring(wiring: SessionRelayMeshWiringV1): void {
  currentWiring = wiring;
}

/** Internal only: drop the wiring (tests); production keeps it for process lifetime. */
export function clearSessionRelayMeshWiring(): void {
  currentWiring = null;
}

export function currentSessionRelayMeshWiring(): SessionRelayMeshWiringV1 | null {
  return currentWiring;
}
