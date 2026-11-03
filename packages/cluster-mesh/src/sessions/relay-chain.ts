// CHAIN-ESTABLISH-2 reference evaluators (RC2.contract r3 vectors/state-transitions.json).
// Pure functions over plain JSON records; results are the frozen decision strings.
import type { RelayErrorCode } from './registry-types.js';

export type ChainDecision = 'allow' | RelayErrorCode | 'paired-opened-model' | 'paired-awaiting-downstream' | 'paired-close-floor-preserved-model' | 'failure-propagation-refused';

export interface PathCheckInput {
  readonly path: readonly string[];
  readonly hopIndex: number;
  readonly visited: readonly string[];
  readonly sender: string;
  readonly receiver: string;
  readonly approved: boolean;
  readonly distributed: boolean;
  readonly revocationCaughtUp: boolean;
  readonly reservationConsumed: boolean;
  readonly competingPair: boolean;
}

// Max links per circuit (B→L→A is 2; a 4th link is refused).
export const RELAY_MAX_LINKS = 3;

// pathCheck: visited must be the exact path prefix through hopIndex; sender/receiver
// the adjacent nodes; no repeated instance (loop); ≤ RELAY_MAX_LINKS links; approved
// and fully distributed (else scope); consumed reservation / competing pair = stale.
export function chainPathCheck(input: PathCheckInput): ChainDecision {
  const { path, hopIndex, visited, sender, receiver } = input;
  if (visited.length !== hopIndex + 1 || !visited.every((v, i) => v === path[i])) return 'relay_route_conflict';
  if (sender !== path[hopIndex] || receiver !== path[hopIndex + 1]) return 'relay_route_conflict';
  if (new Set(path).size !== path.length || visited.includes(receiver)) return 'relay_loop';
  if (path.length - 1 > RELAY_MAX_LINKS) return 'relay_hop_limit';
  if (!input.approved || !input.distributed) return 'relay_scope_refused';
  if (input.reservationConsumed || input.competingPair) return 'relay_stale_generation';
  return 'allow';
}

export interface FrameCheckInput {
  readonly frame: { readonly kind?: string } & Record<string, unknown>;
  readonly state: { readonly opened?: boolean } & Record<string, unknown>;
}

// frameCheck: no Data (or Credit) before Opened on the link.
export function chainFrameCheck(input: FrameCheckInput): ChainDecision {
  if ((input.frame.kind === 'data' || input.frame.kind === 'credit') && input.state.opened === false) {
    return 'relay_protocol_refused';
  }
  return 'allow';
}

export interface RelayRecord extends Record<string, unknown> {
  readonly format?: string;
  readonly kind?: string;
  readonly tunnelId?: string;
  readonly linkGeneration?: number;
  readonly hopIndex?: number;
  readonly visitedInstanceIds?: readonly string[];
  readonly adjacentGrantRef?: unknown;
  readonly peerProofRef?: unknown;
}

interface PreparedRecord {
  readonly path: readonly string[];
  readonly circuitId: string;
  readonly lane: string;
  readonly upstream: { readonly tunnelId: string; readonly linkGeneration: number; readonly grantRef: unknown; readonly peerProofRef: unknown };
  readonly downstream: { readonly tunnelId: string; readonly linkGeneration: number; readonly grantRef: unknown; readonly peerProofRef: unknown };
  readonly descriptorDigest: string;
  readonly preparationId: string;
  readonly routeId: string;
  readonly routeRevision: number;
  readonly routeGeneration: number;
  readonly sessionRef: unknown;
  readonly endpointAdmissionRefs: unknown;
}

export interface OpenPairInput {
  readonly preparedCoordinatesVerified: boolean;
  readonly reservationUnused: boolean;
  readonly competingPair: boolean;
  readonly incoming: RelayRecord;
  readonly outgoing: RelayRecord;
  readonly prepared: PreparedRecord;
  readonly downstreamReady: boolean;
  readonly upstreamReady: boolean;
  readonly downstreamOpened: RelayRecord | null;
  readonly upstreamOpened: RelayRecord | null;
}

const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// openPair: only tunnelId, linkGeneration, hopIndex, visitedInstanceIds,
// adjacentGrantRef and peerProofRef change on the downstream leg. A foreign
// adjacent grant is a scope refusal; other mismatches are route conflicts; an
// upstream Opened before the downstream leg is ready is a protocol violation.
export function chainOpenPair(input: OpenPairInput): ChainDecision {
  if (input.competingPair || !input.reservationUnused) return 'relay_stale_generation';
  const { incoming, outgoing, prepared } = input;
  const shared = ['descriptorDigest', 'preparationId', 'routeId', 'routeRevision', 'routeGeneration', 'sessionRef', 'circuitId', 'lane', 'endpointAdmissionRefs'] as const;
  for (const key of shared) {
    if (!eq(incoming[key], (prepared as unknown as Record<string, unknown>)[key])) return 'relay_route_conflict';
  }
  if (!eq(incoming.adjacentGrantRef, prepared.upstream.grantRef) || !eq(incoming.peerProofRef, prepared.upstream.peerProofRef)) {
    return 'relay_scope_refused';
  }
  if (!eq(outgoing.adjacentGrantRef, prepared.downstream.grantRef)) return 'relay_scope_refused';
  const expected: RelayRecord = {
    ...incoming,
    tunnelId: prepared.downstream.tunnelId,
    linkGeneration: prepared.downstream.linkGeneration,
    hopIndex: (incoming.hopIndex ?? 0) + 1,
    visitedInstanceIds: [...(incoming.visitedInstanceIds ?? []), prepared.path[(incoming.hopIndex ?? 0) + 1]],
    adjacentGrantRef: prepared.downstream.grantRef,
    peerProofRef: prepared.downstream.peerProofRef,
  };
  for (const key of Object.keys(expected)) {
    if (!eq(outgoing[key], expected[key])) return 'relay_route_conflict';
  }
  if (input.upstreamOpened && input.upstreamReady && !input.downstreamReady) return 'relay_protocol_refused';
  if (input.upstreamOpened && input.upstreamOpened.tunnelId !== incoming.tunnelId) return 'relay_route_conflict';
  if (input.downstreamOpened && input.downstreamOpened.tunnelId !== outgoing.tunnelId) return 'relay_route_conflict';
  if (input.upstreamReady && input.downstreamReady && input.upstreamOpened && input.downstreamOpened) return 'paired-opened-model';
  return 'paired-awaiting-downstream';
}
