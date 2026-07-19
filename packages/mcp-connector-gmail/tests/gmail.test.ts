/**
 * BR-72 Wave-1 — Gmail read-only connector proof tests.
 *
 * Covers: manifest is closed read-only (no capability mutates external state);
 * `listCapabilities` returns the declared set; every read capability invoked
 * through a mock `StpConnectorContext` returns `ok:true` + fixture output +
 * an auditId; `getSecret` is NEVER called on a read path; `validateSecrets`
 * discloses state only, never a value.
 */
import { describe, expect, it } from 'vitest';
import type { StpConnectorContext } from '../../mcp-platform/src/runtime.js';
import { createGmailConnector } from '../src/adapter.js';
import { gmailManifest } from '../src/manifest.js';
import {
  getDraftFixture,
  getMessageFixture,
  listDraftsFixture,
  searchThreadsFixture,
} from '../src/fixtures.js';

function makeMockContext(): { ctx: StpConnectorContext; getSecretCalls: string[]; auditEvents: unknown[] } {
  const auditEvents: unknown[] = [];
  const getSecretCalls: string[] = [];
  const ctx: StpConnectorContext = {
    requestId: 'req-1',
    correlationId: 'corr-1',
    auditId: 'audit-1',
    principal: {
      sub: 'user-1',
      claims: {},
      scopes: ['gmail.readonly', 'gmail.compose'],
      tenantRef: 'tenant-a',
      authTime: new Date().toISOString(),
    },
    surface: 'chat',
    session: { mcpSessionId: 'sess-1' },
    tenantRef: 'tenant-a',
    connectorInstanceId: 'conn-1',
    consentRefs: ['grant-1'],
    grantRefs: ['grant-1'],
    connectorConfig: {},
    // A read-only path must NEVER call this — throwing surfaces any violation loudly.
    getSecret: async (name: string) => {
      getSecretCalls.push(name);
      throw new Error(`getSecret('${name}') must never be called on a read-only path`);
    },
    audit: {
      emit: async (event: unknown) => {
        auditEvents.push(event);
      },
    },
    logger: { log: () => {} },
  };
  return { ctx, getSecretCalls, auditEvents };
}

const allCapabilities = [...gmailManifest.resources, ...gmailManifest.tools, ...gmailManifest.prompts];

describe('gmail connector manifest (BR-72 Wave-1 read-only proof)', () => {
  it('declares no capability that mutates external state', () => {
    expect(allCapabilities.length).toBeGreaterThan(0);
    for (const cap of allCapabilities) {
      expect(cap.mutatesExternalSystem).toBe(false);
      expect(cap.mutability).toBe('read-only');
      expect(cap.idempotency.required).toBe(false);
    }
  });

  it('declares the exact BR-72 matrix §7 gmail read-only capability set', () => {
    expect(allCapabilities.map((c) => c.name).sort()).toEqual(
      ['get_draft', 'get_message', 'list_drafts', 'search_threads'].sort(),
    );
  });
});

describe('gmail connector adapter (BR-72 Wave-1 read-only proof)', () => {
  it('listCapabilities returns the declared capability set', async () => {
    const connector = createGmailConnector();
    const caps = await connector.listCapabilities({
      principalRef: 'user-1',
      tenantRef: 'tenant-a',
      connectorInstanceId: 'conn-1',
    });
    expect(caps.map((c) => c.name).sort()).toEqual(
      ['get_draft', 'get_message', 'list_drafts', 'search_threads'].sort(),
    );
  });

  it('resolveTenant narrows within the core-authorized tenant, never re-binds it', async () => {
    const connector = createGmailConnector();
    const resolved = await connector.resolveTenant({
      principalSub: 'user-1',
      tenantRef: 'tenant-a',
      connectorInstanceId: 'conn-1',
      selectorHints: { tenantRef: 'attacker-tenant' },
    });
    expect(resolved.tenantRef).toBe('tenant-a');
    expect(resolved.principalRef).toBe('user-1');
  });

  it('search_threads (tool, read, discover) returns ok:true + fixture output + auditId, never touching getSecret', async () => {
    const connector = createGmailConnector();
    const { ctx, getSecretCalls, auditEvents } = makeMockContext();
    const result = await connector.invokeTool({
      capabilityRef: 'search_threads',
      input: { query: '' },
      ctx,
    });
    if (typeof result === 'string') throw new Error('expected an inline AppToolResult, not a DurableCallRef');
    expect(result.ok).toBe(true);
    expect(result.output).toEqual(searchThreadsFixture);
    expect(result.auditId).toBe('audit-1');
    expect(getSecretCalls).toEqual([]);
    expect(auditEvents.length).toBeGreaterThan(0);
  });

  it('get_message (resource, read) returns ok:true + fixture output + auditId, never touching getSecret', async () => {
    const connector = createGmailConnector();
    const { ctx, getSecretCalls } = makeMockContext();
    const result = await connector.readResource({
      capabilityRef: 'get_message',
      input: { uri: 'gmail://messages/message-synthetic-001' },
      ctx,
    });
    expect(result.ok).toBe(true);
    expect(result.output).toEqual(getMessageFixture['message-synthetic-001']);
    expect(result.auditId).toBe('audit-1');
    expect(getSecretCalls).toEqual([]);
  });

  it('list_drafts (resource, discover) returns ok:true + fixture output + auditId, never touching getSecret', async () => {
    const connector = createGmailConnector();
    const { ctx, getSecretCalls } = makeMockContext();
    const result = await connector.readResource({
      capabilityRef: 'list_drafts',
      input: { uri: 'gmail://drafts' },
      ctx,
    });
    expect(result.ok).toBe(true);
    expect(result.output).toEqual(listDraftsFixture);
    expect(result.auditId).toBe('audit-1');
    expect(getSecretCalls).toEqual([]);
  });

  it('get_draft (resource, read) returns ok:true + fixture output + auditId, never touching getSecret', async () => {
    const connector = createGmailConnector();
    const { ctx, getSecretCalls } = makeMockContext();
    const result = await connector.readResource({
      capabilityRef: 'get_draft',
      input: { uri: 'gmail://drafts/draft-synthetic-001' },
      ctx,
    });
    expect(result.ok).toBe(true);
    expect(result.output).toEqual(getDraftFixture['draft-synthetic-001']);
    expect(result.auditId).toBe('audit-1');
    expect(getSecretCalls).toEqual([]);
  });

  it('validateSecrets discloses state only, never a value, and never calls getSecret', async () => {
    const connector = createGmailConnector();
    const { getSecretCalls } = makeMockContext();
    const statuses = await connector.validateSecrets({
      principalRef: 'user-1',
      tenantRef: 'tenant-a',
      connectorInstanceId: 'conn-1',
    });
    expect(statuses.length).toBeGreaterThan(0);
    for (const status of statuses) {
      expect(status).not.toHaveProperty('value');
      expect(typeof status.name).toBe('string');
      expect(typeof status.scope).toBe('string');
      expect(typeof status.state).toBe('string');
    }
    expect(getSecretCalls).toEqual([]);
  });
});
