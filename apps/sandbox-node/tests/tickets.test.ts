import { describe, expect, it } from 'vitest';
import type { ExecutionNodeTicket } from '../src/index.js';
import { checkTicket, generateTicketKeyPair, issueTicket, sha256Hex, verifyTicketSignature } from '../src/index.js';
import { ExecutionNodeError } from '../src/index.js';

const body = { hello: 'world' };

function ticket(overrides: Partial<ExecutionNodeTicket> = {}): ExecutionNodeTicket {
  const issuedAt = new Date(Date.now() - 1000).toISOString();
  return {
    v: 1,
    tenantId: 'sentropic',
    commandId: 'cmd-1',
    method: 'POST',
    path: '/v1/sandboxes',
    bodySha256: sha256Hex(JSON.stringify(body)),
    targetNodeId: 'artifact-builder-vm-1',
    expectedNodeInstanceId: 'instance-1',
    expectedNodeEpoch: 7,
    ownership: {
      tenantId: 'sentropic',
      poolOwned: false,
      workspaceId: 'ws-1',
      principalId: 'user-1',
      attemptId: 'a-1',
      purpose: 'test',
      generation: 1,
      custodyEpoch: 1,
    },
    issuedAt,
    deadlineAt: new Date(Date.parse(issuedAt) + 10_000).toISOString(),
    ...overrides,
  };
}

const checkOptions = {
  method: 'POST',
  path: '/v1/sandboxes',
  bodySha256: sha256Hex(JSON.stringify(body)),
  nodeInstanceId: 'instance-1',
  nodeEpoch: 7,
};

describe('execution tickets', () => {
  it('verifies a fresh signed ticket', () => {
    const keys = generateTicketKeyPair();
    const signed = issueTicket(ticket(), keys.privateKeyPem);
    expect(verifyTicketSignature(signed.ticket, signed.signature, keys.publicKeyPem)).toBe(true);
    expect(() => checkTicket(signed.ticket, checkOptions)).not.toThrow();
  });

  it('rejects tampered signatures, expired tickets and oversized TTL', () => {
    const keys = generateTicketKeyPair();
    const other = generateTicketKeyPair();
    const signed = issueTicket(ticket(), keys.privateKeyPem);
    expect(verifyTicketSignature(signed.ticket, signed.signature, other.publicKeyPem)).toBe(false);
    expect(verifyTicketSignature({ ...signed.ticket, commandId: 'cmd-2' }, signed.signature, keys.publicKeyPem)).toBe(false);
    const issuedAt = new Date(Date.now() - 60_000).toISOString();
    const expired = ticket({ issuedAt, deadlineAt: new Date(Date.parse(issuedAt) + 10_000).toISOString() });
    expect(() => checkTicket(expired, checkOptions)).toThrowError(ExecutionNodeError);
    const wide = ticket({ deadlineAt: new Date(Date.parse(ticket().issuedAt) + 60_000).toISOString() });
    expect(() => checkTicket(wide, checkOptions)).toThrowError(/TTL/);
  });

  it('rejects body, route, instance and epoch mismatches', () => {
    const t = ticket();
    expect(() => checkTicket(t, { ...checkOptions, bodySha256: 'deadbeef' })).toThrowError(/command_id_payload_mismatch/);
    expect(() => checkTicket(t, { ...checkOptions, path: '/v1/other' })).toThrowError(/command_id_payload_mismatch/);
    expect(() => checkTicket(t, { ...checkOptions, nodeInstanceId: 'other' })).toThrowError(/unknown_node_instance/);
    expect(() => checkTicket(t, { ...checkOptions, nodeEpoch: 8 })).toThrowError(/stale_node_epoch/);
  });
});
