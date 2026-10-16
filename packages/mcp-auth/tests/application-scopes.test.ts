import { describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair, importJWK, SignJWT, type JWK, type KeyLike } from 'jose';

import { fromJwksPort } from '@sentropic/oauth-verify';

import { createMcpAuth } from '../src/core.js';
import { isMcpScope } from '../src/scopes.js';

// 3-qualification: mcp-auth accepts Immo application scopes as opaque scope
// strings. No vocabulary restriction is invented here; issuance policy stays
// with the client/host. Tokens below are REALLY signed (EdDSA) and verified
// end-to-end through @sentropic/oauth-verify — no mocks in this file.

const RESOURCE = 'https://immo.sent-tech.ca/mcp';
const AS = 'https://auth.sent-tech.ca';

const IMMO_READ = 'immo:read';
const IMMO_SEARCH = 'immo:search';
const IMMO_DOCUMENTS_READ = 'immo:documents:read';

interface SigningKey {
  kid: string;
  alg: string;
  publicJwk: JWK;
  privateKey: KeyLike;
}

const createSigningKey = async (kid = 'immo-qual-1'): Promise<SigningKey> => {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA');
  const publicJwk = { ...(await exportJWK(publicKey)), alg: 'EdDSA', kid, use: 'sig' };
  return { alg: 'EdDSA', kid, privateKey, publicJwk };
};

const keySourceFor = (keys: SigningKey[]) => {
  const provider = {
    async findKeyByKid(kid: string) {
      const match = keys.find((key) => key.kid === kid);
      return match ? { alg: match.alg, publicJwk: match.publicJwk } : null;
    },
    async getActiveKey() {
      return keys[0] ? { alg: keys[0].alg, publicJwk: keys[0].publicJwk } : null;
    },
  };
  return fromJwksPort(provider);
};

const signImmoToken = async (
  key: SigningKey,
  options: {
    scope: string;
    audience?: string;
    issuer?: string;
    expiresInSec?: number;
    sub?: string;
    clientId?: string;
  },
): Promise<string> => {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ client_id: options.clientId ?? 'immo-mcp', scope: options.scope })
    .setProtectedHeader({ alg: 'EdDSA', kid: key.kid })
    .setIssuedAt(nowSec)
    .setIssuer(options.issuer ?? AS)
    .setAudience(options.audience ?? RESOURCE)
    .setSubject(options.sub ?? 'immo-user-1')
    .setExpirationTime(nowSec + (options.expiresInSec ?? 600))
    .sign(key.privateKey);
};

const makeImmoMcp = async () => {
  const key = await createSigningKey();
  const mcp = createMcpAuth({
    resource: RESOURCE,
    authorizationServers: [AS],
    scopesSupported: [IMMO_READ, IMMO_SEARCH, IMMO_DOCUMENTS_READ],
    keySource: keySourceFor([key]),
  });
  return { key, mcp };
};

const immoRequest = (token: string, init?: RequestInit): Request =>
  new Request(`${RESOURCE}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    ...init,
  });

describe('3-qualification — Immo-only grants are accepted without generic mcp:* scopes', () => {
  it('accepts an immo:read-only token for an immo:read operation', async () => {
    const { key, mcp } = await makeImmoMcp();
    const token = await signImmoToken(key, { scope: IMMO_READ });
    const ctx = await mcp.verify(immoRequest(token), { requiredScopes: [IMMO_READ] });
    expect(ctx.sub).toBe('immo-user-1');
    expect(ctx.scopes).toEqual([IMMO_READ]);
  });

  it('accepts an immo:search-only token for an immo:search operation', async () => {
    const { key, mcp } = await makeImmoMcp();
    const token = await signImmoToken(key, { scope: IMMO_SEARCH });
    const ctx = await mcp.verify(immoRequest(token), { requiredScopes: [IMMO_SEARCH] });
    expect(ctx.scopes).toEqual([IMMO_SEARCH]);
  });

  it('accepts an immo:documents:read-only token for a documents operation', async () => {
    const { key, mcp } = await makeImmoMcp();
    const token = await signImmoToken(key, { scope: IMMO_DOCUMENTS_READ });
    const ctx = await mcp.verify(immoRequest(token), { requiredScopes: [IMMO_DOCUMENTS_READ] });
    expect(ctx.scopes).toEqual([IMMO_DOCUMENTS_READ]);
  });

  it('accepts every deployed tool scope mapping with a least-privilege grant', async () => {
    const toolScopes: Array<[string, string]> = [
      ['search_lots', IMMO_SEARCH],
      ['get_lot_card', IMMO_READ],
      ['search_signals', IMMO_SEARCH],
      ['get_opportunity_dossier', IMMO_READ],
      ['list_documents', IMMO_DOCUMENTS_READ],
      ['read_document_excerpt', IMMO_DOCUMENTS_READ],
      ['get_reglement_provenance', IMMO_READ],
      ['query_zoning_events', IMMO_READ],
      ['get_zones_geojson', IMMO_READ],
      ['get_lots_geojson', IMMO_READ],
      ['get_grille_pdf', IMMO_DOCUMENTS_READ],
      ['get_pv_pdf', IMMO_DOCUMENTS_READ],
    ];
    const { key, mcp } = await makeImmoMcp();
    const token = await signImmoToken(key, {
      scope: `${IMMO_READ} ${IMMO_SEARCH} ${IMMO_DOCUMENTS_READ}`,
    });
    for (const [tool, scope] of toolScopes) {
      const ctx = await mcp.verify(immoRequest(token), { requiredScopes: [scope] });
      expect(ctx.scopes, tool).toContain(scope);
    }
  });

  it('advertises the three Immo scopes in PRM scopes_supported when configured', async () => {
    const { mcp } = await makeImmoMcp();
    expect(mcp.metadata().scopes_supported).toEqual(
      expect.arrayContaining([IMMO_READ, IMMO_SEARCH, IMMO_DOCUMENTS_READ]),
    );
  });
});


