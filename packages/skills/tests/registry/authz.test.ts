import { describe, expect, it } from 'vitest';

import { authzContextFromContract } from '../../src/registry/authz.js';
import type { ContractAuthzContext } from '../../src/registry/authz.js';

const contractAuthz = (
  overrides: Partial<ContractAuthzContext> = {},
): ContractAuthzContext => ({
  caller: {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
  },
  allowedTools: new Set(['workspace_list', 'initiative_search']),
  permissionMode: 'granular',
  ...overrides,
});

describe('authz contract adapter', () => {
  it('adapts @sentropic/contracts authz into the existing skills authz API', () => {
    const authz = authzContextFromContract(contractAuthz(), {
      workspaceType: 'ai-priorities',
      roles: ['editor'],
      permissions: ['workspace.read'],
    });

    expect(authz).toEqual({
      tenant: {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        workspaceType: 'ai-priorities',
      },
      roles: ['editor'],
      permissions: ['workspace.read'],
      permissionMode: 'allowlist',
      allowedTools: ['workspace_list', 'initiative_search'],
    });
  });

  it('keeps granular and untrusted contract modes restrictive by default', () => {
    expect(
      authzContextFromContract(
        contractAuthz({ allowedTools: new Set(), permissionMode: 'granular' }),
      ).permissionMode,
    ).toBe('allowlist');
    expect(
      authzContextFromContract(
        contractAuthz({ allowedTools: new Set(), permissionMode: 'untrusted' }),
      ).permissionMode,
    ).toBe('allowlist');
  });

  it('keeps non-granular contract modes open when no allowlist is present', () => {
    expect(
      authzContextFromContract(
        contractAuthz({ allowedTools: new Set(), permissionMode: 'on-request' }),
      ).permissionMode,
    ).toBe('open');
  });
});
