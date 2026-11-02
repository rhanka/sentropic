import type { Context } from 'hono';
import type { SessionOriginRegistryPortV1, SessionRef } from '@sentropic/cluster-mesh';
import type { RemoteApprovedTarget, RemoteEvidenceIssuerPorts, RemoteLogin } from '../../services/auth/remote-evidence';
import type { ReceiverEngine, ReceiverLane, ReceiverStage } from './route-table';

export type { RemoteApprovedTarget, RemoteLogin };

/**
 * R-8 source-auth header acceptance fixture, bilateral with the h2a capsule pin (H-2).
 * Until the capsule pin lands, `pinned` is false and `acceptedHeaderNames` is empty:
 * both sides keep `relay_grant_unavailable` and no header name is invented on either side.
 * Negative vectors: pseudo-headers, `host`, cookies and arbitrary headers always refuse.
 */
export const SOURCE_AUTH_HEADER_FIXTURE = {
  pinned: false,
  acceptedHeaderNames: [] as readonly string[],
  negativeNames: ['host', 'cookie', 'authorization', 'x-source-credential', 'x-h2a-source', 'x-sentropic-source'],
} as const;

/** A prepared, unused one-shot outer tunnel (relay-upgrade reservation). */
export interface PreparedTunnel {
  readonly tunnelId: string;
  readonly routeId: string;
  readonly descriptorDigest: string;
  readonly circuitId: string;
  readonly lane: ReceiverLane;
  readonly linkGeneration: number;
  readonly adjacency: { readonly fromInstanceId: string; readonly toInstanceId: string };
  readonly audience: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly consumed: boolean;
}

/** Durable one-shot tunnel reservations. Consumed tunnel IDs cannot be re-upgraded. */
export interface TunnelRegistry {
  lookup(tunnelId: string): PreparedTunnel | null;
  /** CAS consume: returns the tunnel only for the exact unused reservation. */
  consume(tunnelId: string, now: number): { readonly tunnel: PreparedTunnel } | { readonly refusal: 'relay_stale_generation' | 'relay_grant_expired' | 'relay_scope_refused' };
}

/** Verified bound inner-connection context. Product resolves it only inside a bound inner TLS socket. */
export interface BoundContext {
  readonly sessionRef: SessionRef;
  readonly stage: ReceiverStage;
  readonly engineKind: ReceiverEngine;
  readonly lane: ReceiverLane;
  readonly circuitId: string;
  readonly descriptorDigest: string;
  readonly targetDigest: string | null;
  readonly visibility?: 'listing' | 'activated';
  readonly sourceAck?: boolean;
}

export interface SourcePrincipal {
  readonly sourceId: string;
  readonly ownerId: string;
  readonly keyId: string;
  readonly audience: string;
}

/** Admitted binding record: owner/scope resolution for :bindingId. */
export interface BindingRecord {
  readonly bindingId: string;
  readonly ownerId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly sourceSessionId: string;
  readonly targetDigest: string;
}

export interface BrowserSession {
  readonly userId: string;
  readonly sid: string;
  readonly originOk: boolean;
}

/** Endpoint authority: H2-I installation principal. Null while DEP-FED is a source-gap. */
export interface EndpointAuthorityPort {
  authenticateInstallation(request: Request): Promise<{
    readonly instanceId: string;
    readonly audience: string;
  } | null>;
}

/**
 * R-4 ACK atomicity: every commit method returns the ACK only after the matching durable
 * commit. A failed or uncertain commit throws ReceiverRefusal — the route then answers a
 * refusal and never a success-shaped ACK. ACKs bind to the exact request/circuit/stream
 * and digest; they are not portable proof.
 */
export interface EventAckStore {
  commitActivation(input: {
    readonly bindingId: string; readonly sourceSessionId: string; readonly requestDigest: string;
    readonly circuitId: string; readonly operationId: string; readonly policyDigest: string;
  }): { readonly ackDigest: string; readonly authorityRevision: number; readonly gaps: readonly string[] };
  commitEvents(input: {
    readonly bindingId: string; readonly sourceSessionId: string; readonly requestDigest: string;
    readonly circuitId: string; readonly streamId: string; readonly lastEventId: string | null;
  }): { readonly ackDigest: string; readonly admittedThrough: number; readonly gaps: readonly string[] };
  commitProjection(input: {
    readonly sessionRef: SessionRef; readonly requestDigest: string; readonly circuitId: string;
    readonly position: 'origin-writer' | 'listing-grant' | 'drive-binding';
  }): { readonly ackDigest: string };
  commitChat(input: {
    readonly sessionRef: SessionRef; readonly requestDigest: string; readonly circuitId: string;
    readonly contiguousThrough: number;
  }): { readonly ackDigest: string };
}

export type ReceiverHandler = (c: Context, ctx: {
  readonly routeId: string;
  readonly params: Record<string, string>;
  readonly body: unknown;
  readonly bound: BoundContext | null;
  readonly principal: SourcePrincipal | null;
}) => Promise<Response> | Response;

export interface SessionContentReceiverPorts {
  readonly now: () => number;
  /**
   * The real RC1 approvedTarget port (spec/REMOTE_CONTROL_RC1.md:58). Null in product until
   * the native contribution lands — every dependent check stays fail-closed, never filled locally.
   */
  readonly approvedTarget: RemoteEvidenceIssuerPorts['approvedTarget'] | null;
  /** Endpoint authority (H2-I). Null while DEP-FED is a source-gap → relay_grant_unavailable. */
  readonly endpointAuthority: EndpointAuthorityPort | null;
  /** R-8 capsule-pinned source-auth header names; null until pinned → relay_grant_unavailable. */
  readonly sourceAuthHeaders: readonly string[] | null;
  /** Verify a source credential on an exact pinned header name. */
  readonly verifySourceCredential: (headerName: string, value: string) => Promise<SourcePrincipal | null>;
  /** Owner/scope resolution for :bindingId. */
  readonly resolveBinding: (bindingId: string) => Promise<BindingRecord | null>;
  /** Bound inner context; product returns null (no public direct access to the virtual inner mount). */
  readonly resolveBoundContext: (c: Context) => BoundContext | null;
  readonly tunnels: TunnelRegistry;
  readonly resolveBrowserSession: (c: Context) => Promise<BrowserSession | null>;
  readonly eventAckStore: EventAckStore;
  /** RC2.registry sole-writer port (#873). Null → fail-closed. */
  readonly registry: SessionOriginRegistryPortV1 | null;
  /** Frozen RC0 handlers are producer-owned and injected per route; absent → fail-closed refusal. */
  readonly handlers: Readonly<Record<string, ReceiverHandler>>;
  /** Purpose/consent currency per route authority. */
  readonly purposeCurrent: (routeAuthority: string, ctx: { readonly binding: BindingRecord; readonly bound: BoundContext | null }) => Promise<boolean>;
  /** R15 supplement acceptance for the policy routes; false → unsupported_version before policy handling. */
  readonly policySupplementAccepted: boolean;
}
