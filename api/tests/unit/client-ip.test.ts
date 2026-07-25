import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Context } from 'hono';

const connInfo = vi.hoisted(() => ({ address: '10.0.0.9' as string | undefined, throws: false }));
const envMock = vi.hoisted(() => ({
  TRUSTED_PROXY_HOPS: 1,
  TRUSTED_PROXY_CIDRS: undefined as string | undefined,
}));

vi.mock('@hono/node-server/conninfo', () => ({
  getConnInfo: () => {
    if (connInfo.throws) throw new TypeError("Cannot read properties of undefined (reading 'socket')");
    return { remote: { address: connInfo.address } };
  },
}));
vi.mock('../../src/config/env', () => ({ env: envMock }));

import { resolveClientIp, isIpInCidr } from '../../src/utils/client-ip';

/** Minimal Context stub: resolveClientIp only reads request headers. */
const ctx = (headers: Record<string, string>): Context =>
  ({
    req: { header: (name: string) => headers[name.toLowerCase()] },
  }) as unknown as Context;

describe('resolveClientIp', () => {
  beforeEach(() => {
    envMock.TRUSTED_PROXY_HOPS = 1;
    envMock.TRUSTED_PROXY_CIDRS = undefined;
    connInfo.address = '10.0.0.9';
    connInfo.throws = false;
  });
  afterEach(() => vi.clearAllMocks());

  it('takes the rightmost entry with a single trusted proxy', () => {
    // nginx $proxy_add_x_forwarded_for appended the peer it actually saw.
    expect(resolveClientIp(ctx({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('IGNORES a caller-forged prefix — the bypass this fix closes', () => {
    // The caller sent "X-Forwarded-For: 1.2.3.4"; nginx appended the real peer.
    // Reading the header raw would return 1.2.3.4 and let the caller mint a new
    // rate-limit bucket per request.
    const c = ctx({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' });
    expect(resolveClientIp(c)).toBe('203.0.113.7');
    expect(resolveClientIp(c)).not.toBe('1.2.3.4');
  });

  it('is stable across many forged prefixes from the same real client', () => {
    const forged = ['9.9.9.9', 'evil', '::1', '198.51.100.4, 8.8.8.8'];
    const keys = forged.map((prefix) =>
      resolveClientIp(ctx({ 'x-forwarded-for': `${prefix}, 203.0.113.7` })),
    );
    // A bypass would yield 4 distinct buckets; the fix yields exactly one.
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('203.0.113.7');
  });

  it('honours a deeper trusted-proxy chain', () => {
    envMock.TRUSTED_PROXY_HOPS = 2; // external LB + nginx, both appending
    expect(
      resolveClientIp(ctx({ 'x-forwarded-for': 'forged, 203.0.113.7, 172.16.0.2' })),
    ).toBe('203.0.113.7');
  });

  it('ignores X-Forwarded-For entirely when no proxy is trusted', () => {
    envMock.TRUSTED_PROXY_HOPS = 0;
    expect(resolveClientIp(ctx({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '5.6.7.8' }))).toBe(
      '10.0.0.9',
    );
  });

  it('falls back to X-Real-IP when the chain is shorter than expected', () => {
    envMock.TRUSTED_PROXY_HOPS = 2;
    expect(resolveClientIp(ctx({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.9' }))).toBe(
      '198.51.100.9',
    );
  });

  it('falls back to the socket peer when no forwarding header is present', () => {
    expect(resolveClientIp(ctx({}))).toBe('10.0.0.9');
  });

  it('returns "unknown" rather than throwing when the peer address is unavailable', () => {
    connInfo.address = undefined;
    expect(resolveClientIp(ctx({}))).toBe('unknown');
  });

  it('tolerates whitespace and empty entries in the chain', () => {
    expect(resolveClientIp(ctx({ 'x-forwarded-for': ' forged , , 203.0.113.7 ' }))).toBe(
      '203.0.113.7',
    );
  });
  it('does not throw when the connection adapter has no socket bindings', () => {
    // getConnInfo dereferences adapter bindings unguarded on some adapters.
    connInfo.throws = true;
    expect(() => resolveClientIp(ctx({}))).not.toThrow();
    expect(resolveClientIp(ctx({}))).toBe('unknown');
  });

  it('normalizes IPv4-mapped IPv6 so it does not key a second bucket', () => {
    expect(resolveClientIp(ctx({ 'x-forwarded-for': '::ffff:203.0.113.7' }))).toBe('203.0.113.7');
  });
});

describe('resolveClientIp — trusted-proxy CIDR mode', () => {
  beforeEach(() => {
    envMock.TRUSTED_PROXY_HOPS = 1;
    envMock.TRUSTED_PROXY_CIDRS = '10.42.0.0/16, 10.43.0.0/16';
    connInfo.address = '10.42.0.5'; // a Traefik pod
    connInfo.throws = false;
  });

  it('returns the first untrusted entry from the right, whatever the chain length', () => {
    // Robust where hop-counting is not: the same answer for 2 and 3 trusted hops.
    expect(resolveClientIp(ctx({ 'x-forwarded-for': '203.0.113.7, 10.43.0.9' }))).toBe('203.0.113.7');
    expect(
      resolveClientIp(ctx({ 'x-forwarded-for': '203.0.113.7, 10.43.0.9, 10.42.0.2' })),
    ).toBe('203.0.113.7');
  });

  it('still ignores a forged prefix', () => {
    expect(resolveClientIp(ctx({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7, 10.43.0.9' }))).toBe(
      '203.0.113.7',
    );
  });

  it('ignores the header entirely when the peer is NOT one of our proxies', () => {
    // Direct hit on the pod: the caller must not influence its own bucket.
    connInfo.address = '198.51.100.77';
    expect(resolveClientIp(ctx({ 'x-forwarded-for': '1.2.3.4' }))).toBe('198.51.100.77');
  });

  it('falls back to the peer when every entry is a trusted proxy', () => {
    expect(resolveClientIp(ctx({ 'x-forwarded-for': '10.43.0.9, 10.42.0.2' }))).toBe('10.42.0.5');
  });
});

describe('isIpInCidr', () => {
  it('matches IPv4 ranges and rejects neighbours', () => {
    expect(isIpInCidr('10.42.7.3', '10.42.0.0/16')).toBe(true);
    expect(isIpInCidr('10.43.7.3', '10.42.0.0/16')).toBe(false);
    expect(isIpInCidr('203.0.113.7', '203.0.113.7')).toBe(true);
  });

  it('matches IPv6 ranges', () => {
    expect(isIpInCidr('fd00::1234', 'fd00::/8')).toBe(true);
    expect(isIpInCidr('2001:db8::1', 'fd00::/8')).toBe(false);
  });

  it('never cross-matches families, and rejects malformed input', () => {
    expect(isIpInCidr('10.42.0.1', 'fd00::/8')).toBe(false);
    expect(isIpInCidr('not-an-ip', '10.42.0.0/16')).toBe(false);
    expect(isIpInCidr('10.42.0.1', '10.42.0.0/99')).toBe(false);
  });
});
