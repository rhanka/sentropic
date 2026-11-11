/**
 * CMP-E1 API email adapter: flag gate and allowlist parsing.
 * Success-path transport is covered by the package test (stub transport).
 */
import { describe, it, expect } from 'vitest';
import {
  cmEmailAllowlist, createCmEmailPort, isCmEmailPortEnabled,
} from '../../src/services/email/cm-email-port';

describe('CMP-E1 API email adapter', () => {
  it('is disabled by default (preprod-safe)', () => {
    delete process.env.CM_EMAIL_PORT_ENABLED;
    expect(isCmEmailPortEnabled()).toBe(false);
    expect(() => createCmEmailPort()).toThrow('not enabled');
  });

  it('parses the comma-separated allowlist', () => {
    expect(cmEmailAllowlist({ CM_EMAIL_ALLOWED_SENDERS: 'a@x.test, @y.test' } as never))
      .toEqual(['a@x.test', '@y.test']);
    expect(cmEmailAllowlist({} as never)).toEqual([]);
  });

  it('refuses disallowed senders before any transport', async () => {
    process.env.CM_EMAIL_PORT_ENABLED = '1';
    try {
      const port = createCmEmailPort({ allowlist: ['alerts@immo.sent-tech.ca'] });
      await expect(port.send({
        to: 'o@example.com', subject: 's', text: 't',
        fromEmail: 'spoof@evil.test',
        tenantId: 't1', workspaceId: 'w1', appInstanceId: 'a1',
      })).rejects.toThrow('not allowed');
      expect(port.audit()).toHaveLength(0);
    } finally {
      delete process.env.CM_EMAIL_PORT_ENABLED;
    }
  });
});
