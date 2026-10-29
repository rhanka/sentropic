import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const revocationServiceOrigin = 'http://auth-idp:8787';
export const revocationPath = '/api/v1/auth/session/remote-revocations';

// A separate MAC domain binds the exact request and acknowledgement across the HTTP service hop.
export function revocationMac(domain: 'request' | 'ack', value: string): string {
  const secret = process.env.REMOTE_ACTION_REVOCATION_CLIENT_SECRET;
  if (!secret) throw new Error('revocation_key_required');
  return createHmac('sha256', secret).update(`sentropic.remote-revocation-v1/${domain}\0${value}`).digest('hex');
}
export function validRevocationMac(expected: string, actual: string | null): boolean {
  return !!actual && /^[a-f0-9]{64}$/.test(actual)
    && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}
export function signRevocation(body: string, authorization: string): Record<string, string> {
  const stamp = `${Date.now()}:${randomUUID()}`;
  return { 'x-revocation-stamp': stamp,
    'x-revocation-mac': revocationMac('request', `POST\n${revocationPath}\n${stamp}\n${authorization}\n${body}`) };
}
export function authenticateRevocationBody(request: Request, body: string): string | null {
  try {
    const stamp = request.headers.get('x-revocation-stamp') ?? '';
    if (!/^\d{13}:[a-f0-9-]{36}$/.test(stamp) || Math.abs(Date.now() - Number(stamp.split(':')[0])) > 30_000) return null;
    const mac = revocationMac('request', `POST\n${revocationPath}\n${stamp}\n${request.headers.get('authorization')}\n${body}`);
    return validRevocationMac(mac, request.headers.get('x-revocation-mac')) ? mac : null;
  } catch { return null; }
}
