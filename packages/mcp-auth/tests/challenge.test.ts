import { describe, expect, it } from 'vitest';

import { McpAuthError, buildWwwAuthenticate } from '../src/challenge.js';

describe('WWW-Authenticate challenge builder (RFC 6750 + RFC 9728)', () => {
  it('emits a Bearer 401 challenge with resource_metadata', () => {
    const header = buildWwwAuthenticate({
      scheme: 'Bearer',
      error: 'invalid_token',
      errorDescription: 'Access token is invalid.',
      resourceMetadata: 'https://mcp.example.com/.well-known/oauth-protected-resource',
    });
    expect(header).toBe(
      'Bearer error="invalid_token", error_description="Access token is invalid.", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"',
    );
  });

  it('emits a 403 insufficient_scope challenge with the missing scope', () => {
    const header = buildWwwAuthenticate({
      scheme: 'Bearer',
      error: 'insufficient_scope',
      scope: ['mcp:tools:invoke'],
      resourceMetadata: 'https://mcp.example.com/.well-known/oauth-protected-resource',
    });
    expect(header).toContain('error="insufficient_scope"');
    expect(header).toContain('scope="mcp:tools:invoke"');
    expect(header).toContain('resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"');
  });

  it('joins multiple scopes with a space', () => {
    const header = buildWwwAuthenticate({
      scheme: 'Bearer',
      scope: ['mcp:discover', 'mcp:tools:invoke'],
    });
    expect(header).toBe('Bearer scope="mcp:discover mcp:tools:invoke"');
  });

  it('supports the DPoP scheme', () => {
    const header = buildWwwAuthenticate({ scheme: 'DPoP', error: 'invalid_dpop_proof' });
    expect(header).toBe('DPoP error="invalid_dpop_proof"');
  });

  it('returns the bare scheme when no params are present', () => {
    expect(buildWwwAuthenticate({ scheme: 'Bearer' })).toBe('Bearer');
  });
});

describe('McpAuthError', () => {
  it('defaults to the Bearer scheme', () => {
    const err = new McpAuthError(401, 'invalid_token', 'nope');
    expect(err.status).toBe(401);
    expect(err.code).toBe('invalid_token');
    expect(err.scheme).toBe('Bearer');
    expect(err.name).toBe('McpAuthError');
  });

  it('carries the required scopes for a 403', () => {
    const err = new McpAuthError(403, 'insufficient_scope', 'missing', {
      requiredScopes: ['mcp:tools:invoke'],
    });
    expect(err.requiredScopes).toEqual(['mcp:tools:invoke']);
  });
});
