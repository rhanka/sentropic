import { describe, expect, it, vi, beforeEach } from 'vitest';
import { googleDriveManifest } from '../src/manifest.js';
import { createGoogleDriveAdapter } from '../src/adapter.js';
import type { StpConnectorContext } from '../../mcp-platform/src/runtime.js';

describe('Google Drive Connector Proof tests', () => {
  let getSecretMock: any;
  let mockContext: StpConnectorContext;
  const adapter = createGoogleDriveAdapter();

  beforeEach(() => {
    getSecretMock = vi.fn().mockImplementation((name: string) => {
      return Promise.resolve("mock-secret-value");
    });

    mockContext = {
      requestId: 'req-123',
      correlationId: 'corr-123',
      auditId: 'audit-123',
      principal: {
        sub: 'user-123',
        claims: {},
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
        tenantRef: 'tenant-123',
        workspaceRef: 'workspace-123',
        authTime: '2026-07-18T00:00:00Z',
      },
      surface: 'chat',
      session: { mcpSessionId: 'sess-123' },
      tenantRef: 'tenant-123',
      workspaceRef: 'workspace-123',
      connectorInstanceId: 'inst-123',
      consentRefs: ['consent-123'],
      grantRefs: ['grant-123'],
      getSecret: getSecretMock,
      connectorConfig: {},
      audit: {
        emit: vi.fn().mockResolvedValue(undefined),
      },
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      },
    };
  });

  it('assert manifest is read-only (no capability has mutatesExternalSystem: true)', () => {
    for (const res of googleDriveManifest.resources) {
      expect(res.mutability).toBe('read-only');
      expect(res.mutatesExternalSystem).toBe(false);
      expect(res.idempotency.required).toBe(false);
    }
    for (const tool of googleDriveManifest.tools) {
      expect(tool.mutability).toBe('read-only');
      expect(tool.mutatesExternalSystem).toBe(false);
      expect(tool.idempotency.required).toBe(false);
      expect(tool.category).toBe('read');
    }
    for (const p of googleDriveManifest.prompts) {
      expect(p.mutability).toBe('read-only');
      expect(p.mutatesExternalSystem).toBe(false);
      expect(p.idempotency.required).toBe(false);
    }
  });

  it('listCapabilities returns the declared set', async () => {
    const tenantCtx = await adapter.resolveTenant({
      principalSub: 'user-123',
      tenantRef: 'tenant-123',
      workspaceRef: 'workspace-123',
      connectorInstanceId: 'inst-123',
    });
    const capabilities = await adapter.listCapabilities(tenantCtx);
    expect(capabilities).toHaveLength(
      googleDriveManifest.resources.length + googleDriveManifest.tools.length
    );
    expect(capabilities.map((c) => c.name)).toContain('about.get');
    expect(capabilities.map((c) => c.name)).toContain('files.list');
    expect(capabilities.map((c) => c.name)).toContain('files.get');
    expect(capabilities.map((c) => c.name)).toContain('permissions.list');
    expect(capabilities.map((c) => c.name)).toContain('comments.get');
    expect(capabilities.map((c) => c.name)).toContain('files.export');
  });

  it('each read resource invoked returns ok: true + fixture output + an auditId', async () => {
    // 1. about.get
    const aboutRes = await adapter.readResource({
      capabilityRef: 'about.get',
      input: { uri: 'googledrive://tenant-123/about' },
      ctx: mockContext,
    });
    expect(aboutRes.ok).toBe(true);
    expect(aboutRes.output).toHaveProperty('user');
    expect(aboutRes.auditId).toBe(mockContext.auditId);
    expect(aboutRes.redactionClass).toBe('low');

    // 2. files.list
    const filesListRes = await adapter.readResource({
      capabilityRef: 'files.list',
      input: { uri: 'googledrive://tenant-123/files' },
      ctx: mockContext,
    });
    expect(filesListRes.ok).toBe(true);
    expect(filesListRes.output).toHaveProperty('files');
    expect(filesListRes.auditId).toBe(mockContext.auditId);
    expect(filesListRes.redactionClass).toBe('low');

    // 3. files.get
    const fileGetRes = await adapter.readResource({
      capabilityRef: 'files.get',
      input: { uri: 'googledrive://tenant-123/files/file-doc-1' },
      ctx: mockContext,
    });
    expect(fileGetRes.ok).toBe(true);
    expect(fileGetRes.output).toHaveProperty('name', 'Project Plan');
    expect(fileGetRes.auditId).toBe(mockContext.auditId);
    expect(fileGetRes.redactionClass).toBe('low');

    // 4. permissions.list
    const permListRes = await adapter.readResource({
      capabilityRef: 'permissions.list',
      input: { uri: 'googledrive://tenant-123/files/file-doc-1/permissions' },
      ctx: mockContext,
    });
    expect(permListRes.ok).toBe(true);
    expect(permListRes.output).toHaveProperty('permissions');
    expect(permListRes.auditId).toBe(mockContext.auditId);
    expect(permListRes.redactionClass).toBe('moderate');

    // 5. comments.get
    const commentsGetRes = await adapter.readResource({
      capabilityRef: 'comments.get',
      input: { uri: 'googledrive://tenant-123/files/file-doc-1/comments' },
      ctx: mockContext,
    });
    expect(commentsGetRes.ok).toBe(true);
    expect(commentsGetRes.output).toHaveProperty('comments');
    expect(commentsGetRes.auditId).toBe(mockContext.auditId);
    expect(commentsGetRes.redactionClass).toBe('moderate');
  });

  it('export tool invoked returns ok: true + content + mimeType + auditId', async () => {
    const exportRes = await adapter.invokeTool({
      capabilityRef: 'files.export',
      input: { fileId: 'file-doc-1', mimeType: 'text/markdown' },
      ctx: mockContext,
    });
    // Check type narrowing to ensure vitest gets the output structure
    if ('ok' in exportRes) {
      expect(exportRes.ok).toBe(true);
      expect(exportRes.output).toHaveProperty('content');
      expect(exportRes.output).toHaveProperty('mimeType', 'text/markdown');
      expect(exportRes.auditId).toBe(mockContext.auditId);
      expect(exportRes.redactionClass).toBe('moderate');
    } else {
      it.fail('invokeTool returned a DurableCallRef instead of AppToolResult');
    }
  });

  it('getSecret is never called on read resource or tool export paths', async () => {
    // Perform resource reads and tool exports
    await adapter.readResource({
      capabilityRef: 'about.get',
      input: { uri: 'googledrive://tenant-123/about' },
      ctx: mockContext,
    });
    await adapter.readResource({
      capabilityRef: 'files.get',
      input: { uri: 'googledrive://tenant-123/files/file-doc-1' },
      ctx: mockContext,
    });
    await adapter.invokeTool({
      capabilityRef: 'files.export',
      input: { fileId: 'file-doc-1', mimeType: 'text/markdown' },
      ctx: mockContext,
    });

    expect(getSecretMock).not.toHaveBeenCalled();
  });

  it('validateSecrets discloses state only (no values)', async () => {
    const tenantCtx = await adapter.resolveTenant({
      principalSub: 'user-123',
      tenantRef: 'tenant-123',
      workspaceRef: 'workspace-123',
      connectorInstanceId: 'inst-123',
    });
    const secretsStatus = await adapter.validateSecrets(tenantCtx);
    expect(secretsStatus).toBeInstanceOf(Array);
    expect(secretsStatus).toHaveLength(1);
    expect(secretsStatus[0]).toEqual({
      name: 'accessToken',
      scope: 'connector-instance',
      state: 'active',
    });
  });
});
