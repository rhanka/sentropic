import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import type { ExecutionNodeTicket } from './contract.js';
import {
  EXECUTION_NODE_CONTRACT_VERSION,
  EXECUTION_TICKET_TTL_MS,
} from './contract.js';
import { ExecutionNodeError } from './errors.js';

export interface TicketKeyPair {
  readonly publicKeyPem: string;
  readonly privateKeyPem: string;
}

export interface SignedExecutionTicket {
  readonly ticket: ExecutionNodeTicket;
  readonly signature: string;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function generateTicketKeyPair(): TicketKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, unknown] => entry[1] !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

export function ticketSigningBytes(ticket: ExecutionNodeTicket): Buffer {
  return Buffer.from(stableStringify(ticket), 'utf8');
}

export function issueTicket(
  ticket: ExecutionNodeTicket,
  privateKeyPem: string,
): SignedExecutionTicket {
  if (ticket.v !== 1) throw new ExecutionNodeError('command_id_payload_mismatch', 'unsupported ticket version');
  const signature = sign(null, ticketSigningBytes(ticket), createPrivateKey(privateKeyPem));
  return { ticket, signature: signature.toString('base64url') };
}

export function verifyTicketSignature(
  ticket: ExecutionNodeTicket,
  signature: string,
  publicKeyPem: string,
): boolean {
  try {
    return verify(
      null,
      ticketSigningBytes(ticket),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

function parseTime(value: string, field: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new ExecutionNodeError('command_id_payload_mismatch', `invalid ticket ${field}`);
  return time;
}

/** Fail-closed freshness + node binding checks (signature verified separately). */
export function checkTicket(
  ticket: ExecutionNodeTicket,
  options: {
    method: string;
    path: string;
    bodySha256: string;
    nodeInstanceId: string;
    nodeEpoch: number;
    now?: number;
  },
): void {
  if (ticket.v !== 1) throw new ExecutionNodeError('command_id_payload_mismatch', 'unsupported ticket version');
  if (ticket.method !== options.method || ticket.path !== options.path) {
    throw new ExecutionNodeError('command_id_payload_mismatch', 'ticket route mismatch');
  }
  if (ticket.bodySha256 !== options.bodySha256) {
    throw new ExecutionNodeError('command_id_payload_mismatch', 'ticket body mismatch');
  }
  if (ticket.targetNodeId === undefined || ticket.targetNodeId.length === 0) {
    throw new ExecutionNodeError('command_id_payload_mismatch', 'ticket target missing');
  }
  if (ticket.expectedNodeInstanceId !== options.nodeInstanceId) {
    throw new ExecutionNodeError('unknown_node_instance', 'ticket node instance mismatch');
  }
  if (ticket.expectedNodeEpoch !== options.nodeEpoch) {
    throw new ExecutionNodeError('stale_node_epoch', 'ticket node epoch mismatch');
  }
  const issuedAt = parseTime(ticket.issuedAt, 'issuedAt');
  const deadlineAt = parseTime(ticket.deadlineAt, 'deadlineAt');
  if (deadlineAt - issuedAt > EXECUTION_TICKET_TTL_MS) {
    throw new ExecutionNodeError('command_id_payload_mismatch', 'ticket TTL exceeds 30s');
  }
  if (deadlineAt <= issuedAt) {
    throw new ExecutionNodeError('command_id_payload_mismatch', 'ticket deadline not after issuedAt');
  }
  const now = options.now ?? Date.now();
  if (now >= deadlineAt) throw new ExecutionNodeError('command_id_payload_mismatch', 'ticket expired');
  if (issuedAt - now > 5_000) {
    throw new ExecutionNodeError('command_id_payload_mismatch', 'ticket issued in the future');
  }
  void EXECUTION_NODE_CONTRACT_VERSION;
}
