/**
 * Authenticated control client (L1, spec 6.1/6.2).
 *
 * Published `@sentropic/llm-gateway/node/control-client` surface:
 * `createGatewayControlClient({ controlSocket })` in production; tests and
 * the in-process SDK pass a bound transport directly. Receipt import/revoke
 * and qualification operations arrive in L4 on this same client.
 */
import type { ControlTransport } from './control-server.js';
import { readFile } from 'node:fs/promises';
import { createSocketControlTransport } from './socket-control-transport.js';
import type {
  AcquireSessionInput,
  IssuedSession,
  StoredReceipt,
} from '../session-service.js';

export interface GatewayControlClient {
  acquireSession(input: AcquireSessionInput): Promise<IssuedSession>;
  revokeSession(input: { ownerScopeRef: string; sessionRef: string }): Promise<{ revoked: boolean }>;
  listSessions(input: { ownerScopeRef: string }): Promise<
    {
      sessionRef: string;
      workspaceRef: string;
      clientSessionRef: string;
      expiresAt: string;
      revoked: boolean;
      policyRevision: string;
    }[]
  >;
  readReceipt(input: { ownerScopeRef: string; receiptId: string }): Promise<StoredReceipt>;
}

export const createGatewayControlClient = (options: {
  transport?: ControlTransport;
  token?: string;
  controlSocket?: string;
}): GatewayControlClient => {
  if (!options.transport && !options.controlSocket) throw new Error('private controlSocket or trusted transport required');
  const transport = options.transport ?? createSocketControlTransport(options.controlSocket!);
  const call = async <T>(op: string, args: unknown): Promise<T> =>
    (await transport.invoke(op, args, options.token ?? await readFile(`${options.controlSocket}.auth`, 'utf8'))) as T;
  return {
    acquireSession: (input) => call('acquireSession', input),
    revokeSession: (input) => call('revokeSession', input),
    listSessions: (input) => call('listSessions', input),
    readReceipt: (input) => call('readReceipt', input),
  };
};
