/**
 * CMP-E1 email port: allowlist, rate limits, PII-free audit.
 */
import { describe, it, expect } from 'vitest';
import {
  createEmailPort, createEmailRateLimiter, isSenderAllowed,
} from '../../src/messaging/email-port';

const scope = { tenantId: 't1', workspaceId: 'w1', appInstanceId: 'radar-immobilier-preprod' };

describe('CMP-E1 email port', () => {
  it('allowlists exact senders and @domain suffixes', () => {
    expect(isSenderAllowed(['alerts@immo.sent-tech.ca'], 'alerts@immo.sent-tech.ca')).toBe(true);
    expect(isSenderAllowed(['@immo.sent-tech.ca'], 'noreply@immo.sent-tech.ca')).toBe(true);
    expect(isSenderAllowed(['alerts@immo.sent-tech.ca'], 'spoof@evil.test')).toBe(false);
  });

  it('rate-limits per app and audits without PII', async () => {
    const limiter = createEmailRateLimiter({ maxPerWindow: 1, windowMs: 60_000 });
    const sent: unknown[] = [];
    const port = createEmailPort({
      allowedSenders: ['@immo.sent-tech.ca'],
      limiter,
      transport: { send: async (req) => { sent.push(req); return { messageId: 'm1' }; } },
    });
    const result = await port.send({
      ...scope, to: 'owner@example.com', subject: 'Alert', text: 'firing',
      fromEmail: 'alerts@immo.sent-tech.ca',
    });
    expect(result.messageId).toBe('m1');
    await expect(port.send({
      ...scope, to: 'owner@example.com', subject: 'Again', text: 'firing',
      fromEmail: 'alerts@immo.sent-tech.ca',
    })).rejects.toThrow('rate exceeded');
    const [event] = port.audit();
    expect(event?.toDomain).toBe('example.com');
    expect(event?.subjectDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('refuses malformed requests and disallowed senders fail-closed', async () => {
    const port = createEmailPort({
      allowedSenders: ['alerts@immo.sent-tech.ca'],
      limiter: createEmailRateLimiter({ maxPerWindow: 10, windowMs: 60_000 }),
      transport: { send: async () => ({ messageId: 'x' }) },
    });
    const base = { ...scope, to: 'o@example.com', subject: 's', text: 't', fromEmail: 'alerts@immo.sent-tech.ca' };
    await expect(port.send({ ...base, to: 'not-an-email' })).rejects.toThrow();
    await expect(port.send({ ...base, fromEmail: 'spoof@evil.test' })).rejects.toThrow('not allowed');
  });
});
