/**
 * Authenticated control server (L1, spec 6.1/6.2).
 *
 * The private control channel sits behind a control token issued at host
 * start: only the trusted launcher holds it, an inference Bearer [REDACTED] never
 * authenticates here, and every refusal happens before any state change.
 * Loopback HTTP alone or session-ID knowledge is never sufficient.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import { GatewaySessionService } from '../session-service.js';

export class ControlAuthError extends Error {
  readonly code = 'CONTROL-UNAUTHENTICATED';
  constructor() {
    super('control channel requires the trusted control token');
    this.name = 'ControlAuthError';
  }
}

export interface ControlTransport {
  invoke(op: string, args: unknown, token: string): Promise<unknown>;
}

export class ControlOpError extends Error {
  readonly code = 'CONTROL-UNKNOWN-OP';
  constructor(op: string) {
    super(`unknown control operation: ${op}`);
    this.name = 'ControlOpError';
  }
}

const digestOf = (value: string): Buffer =>
  createHash('sha256').update(value, 'utf8').digest();

export class ControlServer {
  private readonly service: GatewaySessionService;
  private readonly controlDigest: Buffer;
  private readonly ownerScopeRef: string;

  constructor(private readonly options: { service: GatewaySessionService; controlToken: string; ownerScopeRef: string; beforeAcquire?: (input: Record<string, unknown>) => Promise<void> }) {
    if (!options.controlToken || options.controlToken.length < 16) {
      throw new ControlAuthError();
    }
    this.service = options.service;
    if (!options.ownerScopeRef) throw new ControlAuthError();
    this.ownerScopeRef = options.ownerScopeRef;
    this.controlDigest = digestOf(options.controlToken);
  }

  private verified(token: string): boolean {
    if (typeof token !== 'string' || !token) return false;
    return timingSafeEqual(digestOf(token), this.controlDigest);
  }

  async invoke(op: string, args: unknown, token: string): Promise<unknown> {
    if (!this.verified(token)) throw new ControlAuthError();
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ControlAuthError();
    const supplied = args as Record<string, unknown>;
    if (supplied.ownerScopeRef !== undefined && supplied.ownerScopeRef !== this.ownerScopeRef) throw new ControlAuthError();
    const input = { ...supplied, ownerScopeRef: this.ownerScopeRef };
    switch (op) {
      case 'acquireSession':
        await this.options.beforeAcquire?.(input);
        return this.service.acquireSession(input as never);
      case 'revokeSession':
        return this.service.revokeSession(input as never);
      case 'listSessions':
        return this.service.listSessions(input as never);
      case 'readReceipt':
        return this.service.readReceipt(input as never);
      default:
        throw new ControlOpError(op);
    }
  }
}

/** In-process trusted SDK transport (may replace the socket inside one process). */
export const createInProcessControlTransport = (server: ControlServer): ControlTransport => ({
  invoke: (op, args, token) => server.invoke(op, args, token),
});
