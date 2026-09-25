import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { CallerAuthRequestContext } from '../ports/caller-auth.js';
import type { CallerAuthScheme } from '../personal-passthrough/caller-auth.js';
import { GatewayError } from '../router/errors.js';
import { validateAuthContext } from './caller-auth.js';

export const parseCallerCredential = (headers: Readonly<Record<string, string>>):
  { scheme: CallerAuthScheme; token: string } | undefined => {
  const auth = Object.entries(headers).filter(([key]) => key.toLowerCase() === 'authorization');
  const keys = Object.entries(headers).filter(([key]) => key.toLowerCase() === 'x-api-key');
  if (auth.length + keys.length !== 1) return undefined;
  if (auth.length) {
    const match = /^(Bearer|DPoP)\s+(\S+)$/i.exec(auth[0]![1].trim());
    return match ? { scheme: match[1]!.toLowerCase() === 'bearer' ? 'Bearer' : 'DPoP', token: match[2]! } : undefined;
  }
  const token = keys[0]![1].trim();
  return token && !/\s/.test(token) ? { scheme: 'x-api-key', token } : undefined;
};

export const bridgeHeaders = (
  token: string, scheme: CallerAuthScheme, headers: Readonly<Record<string, string>>,
): Headers | undefined => {
  const parsed = parseCallerCredential(headers);
  if (!parsed || parsed.token !== token || parsed.scheme !== scheme) return undefined;
  const result = new Headers({ authorization: `${scheme === 'x-api-key' ? 'Bearer' : scheme} ${token}` });
  const proofs = Object.entries(headers).filter(([key]) => key.toLowerCase() === 'dpop');
  if (proofs.length > 1) return undefined;
  if (proofs.length) result.set('dpop', proofs[0]![1]);
  // Explicit credentials only: cookies and untrusted forwarded headers never enter the probe.
  return result;
};

export const runAuthBridge = async <T>(
  middleware: MiddlewareHandler, headers: Headers, context: CallerAuthRequestContext,
  project: (c: Context) => T,
): Promise<T | undefined> => {
  validateAuthContext(context);
  const app = new Hono();
  let unavailable = false;
  let continued = false;
  let identity: T | undefined;
  app.onError(() => { unavailable = true; return new Response(null, { status: 503 }); });
  app.use('*', middleware);
  app.all('*', c => {
    identity = project(c);
    continued = true;
    return new Response(null, { status: 204 });
  });
  const response = await app.fetch(new Request(context.url, {
    method: context.method, headers, signal: context.signal,
  }));
  context.signal?.throwIfAborted();
  if (unavailable || response.status >= 500) throw authUnavailable();
  // Deliberate RFC 6750 deviation: insufficient_scope/accountPolicy 403 becomes provider 401.
  if (response.status === 401 || response.status === 403) return undefined;
  if (!continued || !response.ok) throw authUnavailable();
  return identity;
};

export const authUnavailable = () => new GatewayError('caller-auth-unavailable', 'authentication unavailable');
