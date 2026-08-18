import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

import { env } from '../config/env';

/**
 * Resolve the client IP from a request, WITHOUT trusting caller-supplied headers.
 *
 * `X-Forwarded-For` is fully caller-controllable: anyone can send
 * `X-Forwarded-For: 1.2.3.4` and it reaches the app unchanged unless a proxy we
 * operate overwrites or appends to it. Reading it raw makes every IP-keyed control
 * (rate limiting, anonymous quotas, audit) trivially bypassable — the caller varies
 * the header per request to mint unlimited buckets.
 *
 * Two modes, in order of preference:
 *
 * 1. TRUSTED_PROXY_CIDRS (preferred, topology-agnostic). Verify the socket peer is
 *    a proxy we operate, then walk `X-Forwarded-For` from the RIGHT, skipping
 *    entries that are themselves trusted proxies, and return the first entry that
 *    is not. This is robust to a proxy that does not append, or appends more than
 *    one entry — cases where pure hop-counting silently selects forged data.
 *
 * 2. TRUSTED_PROXY_HOPS (fallback). Take the entry `hops` positions from the right.
 *    Correct ONLY if every counted proxy appends exactly one entry. Setting it too
 *    HIGH reads an attacker-supplied entry; too LOW collapses every client into the
 *    proxy's own address — one shared bucket, i.e. a self-inflicted denial of
 *    service on login. Prefer mode 1 whenever the CIDRs are known.
 *
 * Both fall back to the socket peer address, which is never caller-controlled.
 */

/** `::ffff:203.0.113.7` and `203.0.113.7` must key to the same bucket. */
const normalizeIp = (raw: string): string => {
  const value = raw.trim().replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value);
  return mapped ? mapped[1] : value;
};

const ipv4ToInt = (ip: string): bigint | null => {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    out = (out << 8n) | BigInt(octet);
  }
  return out;
};

const ipv6ToInt = (ip: string): bigint | null => {
  if (!ip.includes(':')) return null;
  const [head, tail] = ip.split('::', 2);
  const headGroups = head ? head.split(':').filter(Boolean) : [];
  const tailGroups = tail !== undefined && tail ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  if (ip.includes('::') ? missing < 0 : headGroups.length !== 8) return null;
  const groups = ip.includes('::')
    ? [...headGroups, ...Array(missing).fill('0'), ...tailGroups]
    : headGroups;
  let out = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    out = (out << 16n) | BigInt(parseInt(group, 16));
  }
  return out;
};

const toInt = (ip: string): { value: bigint; bits: number } | null => {
  const v4 = ipv4ToInt(ip);
  if (v4 !== null) return { value: v4, bits: 32 };
  const v6 = ipv6ToInt(ip);
  if (v6 !== null) return { value: v6, bits: 128 };
  return null;
};

/** True when `ip` falls inside `cidr` (either may be v4 or v6; families must match). */
export const isIpInCidr = (ip: string, cidr: string): boolean => {
  const [network, prefixRaw] = cidr.trim().split('/');
  const target = toInt(normalizeIp(ip));
  const base = toInt(normalizeIp(network));
  if (!target || !base || target.bits !== base.bits) return false;

  const prefix = prefixRaw === undefined ? base.bits : Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > base.bits) return false;

  const shift = BigInt(base.bits - prefix);
  return target.value >> shift === base.value >> shift;
};

const parseCidrList = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/** Socket peer address. Never caller-controlled; `getConnInfo` throws on some adapters. */
const socketPeer = (c: Context): string | null => {
  try {
    const address = getConnInfo(c).remote.address;
    return address ? normalizeIp(address) : null;
  } catch {
    return null;
  }
};

export function resolveClientIp(c: Context): string {
  const peer = socketPeer(c);
  const trustedCidrs = parseCidrList(env.TRUSTED_PROXY_CIDRS);

  const forwarded = c.req.header('x-forwarded-for');
  const entries = (forwarded ?? '')
    .split(',')
    .map(normalizeIp)
    .filter(Boolean);

  // Mode 1 — trusted-peer CIDRs.
  if (trustedCidrs.length > 0) {
    const isTrusted = (ip: string) => trustedCidrs.some((cidr) => isIpInCidr(ip, cidr));
    // A direct caller (peer not one of our proxies) may not influence its own key.
    if (!peer || !isTrusted(peer)) return peer ?? 'unknown';
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (!isTrusted(entries[i])) return entries[i];
    }
    return peer;
  }

  // Mode 2 — hop counting.
  const hops = env.TRUSTED_PROXY_HOPS;
  if (hops > 0) {
    const index = entries.length - hops;
    if (index >= 0 && entries[index]) return entries[index];
    // `X-Real-IP` is a single value set by our own nginx from `$remote_addr`, so it
    // cannot carry an attacker-prependable list; consulted only when the chain is
    // absent or shorter than the configured hop count.
    const realIp = c.req.header('x-real-ip');
    if (realIp) return normalizeIp(realIp);
  }

  return peer ?? 'unknown';
}
