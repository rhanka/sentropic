import { beforeEach, describe, expect, it, vi } from 'vitest';

// @sentropic/oauth-verify is a SKELETON in this lot (its verify fns throw "not implemented";
// Lot 1 implements them in parallel). We MOCK its verify primitives to exercise mcp-auth's
// OWN logic: PRM serving, audience/issuer wiring, scope re-assertion, DPoP enforcement,
// tid hook, and challenge shape. The real round-trip activates when Lot 1 merges.
vi.mock('@sentropic/oauth-verify', () => {
  class TokenVerifyError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'TokenVerifyError';
    }
  }
  class DpopVerifyError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'DpopVerifyError';
    }
  }
  return {
    TokenVerifyError,
    DpopVerifyError,
    fromRemoteJwks: vi.fn(() => ({ resolveKey: vi.fn() })),
    verifyAccessToken: vi.fn(),
    verifyDpopProof: vi.fn(),
  };
});

import {
  fromRemoteJwks,
  verifyAccessToken,
  verifyDpopProof,
  TokenVerifyError,
  DpopVerifyError,
} from '@sentropic/oauth-verify';
import { createMcpAuth } from '../src/core.js';

const RESOURCE = 'https://mcp.example.com';
const AS = 'https://auth.sent-tech.ca';

const makeMcp = (overrides = {}) =>
  createMcpAuth({
    resource: RESOURCE,
    authorizationServers: [AS],
    scopesSupported: ['mcp:tools:invoke'],
    ...overrides,
  });

const bearer = (path = '/mcp/invoke', token = 'tok') =>
  new Request(`${RESOURCE}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });

beforeEach(() => {
  vi.mocked(verifyAccessToken).mockReset();
  vi.mocked(verifyDpopProof).mockReset();
});

describe('createMcpAuth — construction', () => {
  it('throws when no authorization server is supplied', () => {
    expect(() => createMcpAuth({ resource: RESOURCE, authorizationServers: [] })).toThrow();
  });

  it('does NOT resolve the key source at construction (lazy until first verify)', () => {
    vi.mocked(fromRemoteJwks).mockClear();
    makeMcp();
    expect(fromRemoteJwks).not.toHaveBeenCalled();
  });

  it('defaults the key source to the AS remote JWKS on first verify', async () => {
    vi.mocked(fromRemoteJwks).mockClear();
    vi.mocked(verifyAccessToken).mockResolvedValue({
      sub: 'u', iss: AS, aud: RESOURCE, exp: 0, iat: 0, scope: 'mcp:tools:invoke',
    });
    const mcp = makeMcp();
    await mcp.verify(bearer());
    expect(fromRemoteJwks).toHaveBeenCalledWith(`${AS}/.well-known/jwks.json`);
  });
});

describe('createMcpAuth — handle() PRM serving', () => {
  it('serves the RFC 9728 PRM document at the well-known path', async () => {
    const mcp = makeMcp();
    const res = await mcp.handle(new Request(`${RESOURCE}/.well-known/oauth-protected-resource`));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const doc = await res!.json();
    expect(doc.resource).toBe(RESOURCE);
    expect(doc.authorization_servers).toEqual([AS]);
    expect(doc.bearer_methods_supported).toEqual(['header']);
  });

  it('passes through (null) for non-well-known requests', async () => {
    const mcp = makeMcp();
    expect(await mcp.handle(bearer())).toBeNull();
  });
});

describe('createMcpAuth — verify() happy path', () => {
  it('verifies a token with audience=resource, issuer=AS and returns the context', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      sub: 'user-1',
      iss: AS,
      aud: RESOURCE,
      exp: 0,
      iat: 0,
      scope: 'mcp:tools:invoke mcp:discover',
      client_id: 'client-1',
      tid: 'tenant-1',
    });
    const mcp = makeMcp();
    const ctx = await mcp.verify(bearer(), { requiredScopes: ['mcp:tools:invoke'] });

    expect(verifyAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'tok', audience: RESOURCE, issuer: [AS] }),
    );
    expect(ctx).toMatchObject({
      sub: 'user-1',
      clientId: 'client-1',
      tid: 'tenant-1',
      jkt: null,
    });
    expect(ctx.scopes).toContain('mcp:tools:invoke');
  });
});

describe('createMcpAuth — verify() rejections → challenge', () => {
  it('maps a token-verify failure to a 401 invalid_token challenge with resource_metadata', async () => {
    vi.mocked(verifyAccessToken).mockRejectedValue(new TokenVerifyError('expired'));
    const mcp = makeMcp();
    const err = await mcp.verify(bearer()).then(() => null, (e) => e);
    expect(err).not.toBeNull();
    const res = mcp.challenge(err);
    expect(res.status).toBe(401);
    const www = res.headers.get('WWW-Authenticate')!;
    expect(www).toContain('Bearer');
    expect(www).toContain('error="invalid_token"');
    expect(www).toContain(`resource_metadata="${RESOURCE}/.well-known/oauth-protected-resource"`);
  });

  it('returns a 403 insufficient_scope challenge when a required scope is missing', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      sub: 'user-1',
      iss: AS,
      aud: RESOURCE,
      exp: 0,
      iat: 0,
      scope: 'mcp:discover',
    });
    const mcp = makeMcp();
    const err = await mcp
      .verify(bearer(), { requiredScopes: ['mcp:tools:invoke'] })
      .then(() => null, (e) => e);
    const res = mcp.challenge(err);
    expect(res.status).toBe(403);
    const www = res.headers.get('WWW-Authenticate')!;
    expect(www).toContain('error="insufficient_scope"');
    expect(www).toContain('scope="mcp:tools:invoke"');
  });

  it('rejects a missing Authorization header with a 401', async () => {
    const mcp = makeMcp();
    const req = new Request(`${RESOURCE}/mcp/invoke`, { method: 'POST' });
    const err = await mcp.verify(req).then(() => null, (e) => e);
    const res = mcp.challenge(err);
    expect(res.status).toBe(401);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects an unsupported scheme with a 401', async () => {
    const mcp = makeMcp();
    const req = new Request(`${RESOURCE}/mcp/invoke`, {
      method: 'POST',
      headers: { authorization: 'Basic abc' },
    });
    const err = await mcp.verify(req).then(() => null, (e) => e);
    expect(mcp.challenge(err).status).toBe(401);
  });
});

describe('createMcpAuth — DPoP enforcement', () => {
  it('requires the DPoP scheme + proof for a cnf.jkt-bound token', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      sub: 'u', iss: AS, aud: RESOURCE, exp: 0, iat: 0, scope: 'mcp:tools:invoke',
      cnf: { jkt: 'thumb-1' },
    });
    const mcp = makeMcp();
    // Bearer scheme on a bound token → 401.
    const err = await mcp.verify(bearer()).then(() => null, (e) => e);
    expect(mcp.challenge(err).status).toBe(401);
    expect(verifyDpopProof).not.toHaveBeenCalled();
  });

  it('verifies the DPoP proof and returns the jkt when bound + DPoP scheme present', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      sub: 'u', iss: AS, aud: RESOURCE, exp: 0, iat: 0, scope: 'mcp:tools:invoke',
      cnf: { jkt: 'thumb-1' },
    });
    vi.mocked(verifyDpopProof).mockResolvedValue({ jkt: 'thumb-1', jti: 'j1' });
    const mcp = makeMcp();
    const req = new Request(`${RESOURCE}/mcp/invoke`, {
      method: 'POST',
      headers: { authorization: 'DPoP tok', dpop: 'proof' },
    });
    const ctx = await mcp.verify(req, { requiredScopes: ['mcp:tools:invoke'] });
    expect(ctx.jkt).toBe('thumb-1');
    expect(verifyDpopProof).toHaveBeenCalledWith(
      expect.objectContaining({ proof: 'proof', expectedJkt: 'thumb-1', accessToken: 'tok' }),
    );
  });

  it('maps a DPoP-verify failure to a 401 invalid_dpop_proof challenge', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      sub: 'u', iss: AS, aud: RESOURCE, exp: 0, iat: 0, scope: 'mcp:tools:invoke',
      cnf: { jkt: 'thumb-1' },
    });
    vi.mocked(verifyDpopProof).mockRejectedValue(new DpopVerifyError('bad proof'));
    const mcp = makeMcp();
    const req = new Request(`${RESOURCE}/mcp/invoke`, {
      method: 'POST',
      headers: { authorization: 'DPoP tok', dpop: 'proof' },
    });
    const err = await mcp.verify(req).then(() => null, (e) => e);
    const res = mcp.challenge(err);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('error="invalid_dpop_proof"');
  });

  it('requires a DPoP proof when requireDpop is set even for an unbound token', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      sub: 'u', iss: AS, aud: RESOURCE, exp: 0, iat: 0, scope: 'mcp:tools:invoke',
    });
    const mcp = makeMcp({ requireDpop: true });
    const err = await mcp.verify(bearer()).then(() => null, (e) => e);
    expect(mcp.challenge(err).status).toBe(401);
  });
});

describe('createMcpAuth — tid hook', () => {
  it('rejects a token without tid when requireTid=true', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      sub: 'u', iss: AS, aud: RESOURCE, exp: 0, iat: 0, scope: 'mcp:tools:invoke',
    });
    const mcp = makeMcp({ requireTid: true });
    const err = await mcp.verify(bearer()).then(() => null, (e) => e);
    expect(mcp.challenge(err).status).toBe(403);
  });

  it('honors a predicate requireTid', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      sub: 'u', iss: AS, aud: RESOURCE, exp: 0, iat: 0, scope: 'mcp:tools:invoke', tid: 'tenant-x',
    });
    const mcp = makeMcp({ requireTid: (tid: string | undefined) => tid === 'tenant-allowed' });
    const err = await mcp.verify(bearer()).then(() => null, (e) => e);
    expect(mcp.challenge(err).status).toBe(403);
  });
});
