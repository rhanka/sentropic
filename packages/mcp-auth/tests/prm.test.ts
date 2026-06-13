import { describe, expect, it } from 'vitest';

import {
  buildProtectedResourceMetadata,
  protectedResourceMetadataUrl,
  PROTECTED_RESOURCE_METADATA_PATH,
} from '../src/prm.js';

describe('RFC 9728 Protected Resource Metadata', () => {
  it('builds a PRM document with the mandatory fields', () => {
    const doc = buildProtectedResourceMetadata({
      resource: 'https://mcp.example.com',
      authorizationServers: ['https://auth.sent-tech.ca'],
      scopesSupported: ['mcp:tools:invoke'],
    });
    expect(doc).toEqual({
      resource: 'https://mcp.example.com',
      authorization_servers: ['https://auth.sent-tech.ca'],
      scopes_supported: ['mcp:tools:invoke'],
      bearer_methods_supported: ['header'],
      dpop_signing_alg_values_supported: ['EdDSA'],
    });
  });

  it('trims a trailing slash on the resource identifier', () => {
    const doc = buildProtectedResourceMetadata({
      resource: 'https://mcp.example.com/',
      authorizationServers: ['https://auth.sent-tech.ca'],
    });
    expect(doc.resource).toBe('https://mcp.example.com');
  });

  it('omits scopes_supported when none are configured', () => {
    const doc = buildProtectedResourceMetadata({
      resource: 'https://mcp.example.com',
      authorizationServers: ['https://auth.sent-tech.ca'],
    });
    expect(doc.scopes_supported).toBeUndefined();
  });

  it('includes resource_documentation when provided', () => {
    const doc = buildProtectedResourceMetadata({
      resource: 'https://mcp.example.com',
      authorizationServers: ['https://auth.sent-tech.ca'],
      resourceDocumentation: 'https://docs.example.com/mcp',
    });
    expect(doc.resource_documentation).toBe('https://docs.example.com/mcp');
  });

  it('allows overriding the DPoP signing algorithms', () => {
    const doc = buildProtectedResourceMetadata({
      resource: 'https://mcp.example.com',
      authorizationServers: ['https://auth.sent-tech.ca'],
      dpopSigningAlgValuesSupported: ['ES256'],
    });
    expect(doc.dpop_signing_alg_values_supported).toEqual(['ES256']);
  });

  it('derives the well-known URL from the resource', () => {
    expect(protectedResourceMetadataUrl('https://mcp.example.com/')).toBe(
      'https://mcp.example.com/.well-known/oauth-protected-resource',
    );
    expect(PROTECTED_RESOURCE_METADATA_PATH).toBe('/.well-known/oauth-protected-resource');
  });
});
