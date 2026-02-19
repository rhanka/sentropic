import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getValidAccessTokenMock, loadExtensionConfigMock } = vi.hoisted(() => ({
  getValidAccessTokenMock: vi.fn(),
  loadExtensionConfigMock: vi.fn(),
}));

vi.mock('../../chrome-ext/extension-auth', () => ({
  getValidAccessToken: getValidAccessTokenMock,
}));

vi.mock('../../chrome-ext/extension-config', () => ({
  loadExtensionConfig: loadExtensionConfigMock,
}));

type ToolPermissionsModule = typeof import('../../chrome-ext/tool-permissions');

const importToolPermissions = async (): Promise<ToolPermissionsModule> => {
  vi.resetModules();
  return import('../../chrome-ext/tool-permissions');
};

const createChromeStorageMock = () => {
  const storage: Record<string, unknown> = {};

  const get = vi.fn(async (keys?: unknown) => {
    if (Array.isArray(keys)) {
      return keys.reduce<Record<string, unknown>>((acc, key) => {
        if (typeof key === 'string' && key in storage) {
          acc[key] = storage[key];
        }
        return acc;
      }, {});
    }
    if (typeof keys === 'string') {
      return keys in storage ? { [keys]: storage[keys] } : {};
    }
    return { ...storage };
  });

  const set = vi.fn(async (values: Record<string, unknown>) => {
    Object.assign(storage, values);
  });

  return { get, set, storage };
};

describe('chrome-ext tool-permissions', () => {
  beforeEach(() => {
    const storage = createChromeStorageMock();
    (globalThis as any).chrome = {
      storage: {
        local: storage,
      },
    };

    getValidAccessTokenMock.mockReset();
    getValidAccessTokenMock.mockResolvedValue(null);
    loadExtensionConfigMock.mockReset();
    loadExtensionConfigMock.mockResolvedValue({
      apiBaseUrl: 'http://localhost:8787/api/v1',
    });

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(
      new Error('Network disabled in UI tests (mock fetch before use)'),
    );
  });

  it('normalizes supported origin patterns and rejects invalid ones', async () => {
    const permissions = await importToolPermissions();

    expect(permissions.normalizePermissionOrigin('*')).toBe('*');
    expect(permissions.normalizePermissionOrigin('https://*')).toBe('https://*');
    expect(permissions.normalizePermissionOrigin('*.matchid.io')).toBe(
      '*.matchid.io',
    );
    expect(permissions.normalizePermissionOrigin('https://*.matchid.io')).toBe(
      'https://*.matchid.io',
    );
    expect(
      permissions.normalizePermissionOrigin('https://deces.matchid.io/path?q=1'),
    ).toBe('https://deces.matchid.io');
    expect(permissions.normalizePermissionOrigin('https://*.bad/path')).toBeNull();
    expect(permissions.normalizePermissionOrigin('chrome://extensions')).toBeNull();

    expect(
      permissions.normalizeRuntimePermissionOrigin(
        'https://deces.matchid.io/recherche',
      ),
    ).toBe('https://deces.matchid.io');
    expect(
      permissions.normalizeRuntimePermissionOrigin('chrome://extensions'),
    ).toBeNull();
  });

  it('resolves the most specific matching permission (tool + origin wildcards)', async () => {
    const permissions = await importToolPermissions();

    await permissions.upsertToolPermissionPolicy({
      toolName: 'tab_action:*',
      origin: '*',
      policy: 'allow',
    });
    await permissions.upsertToolPermissionPolicy({
      toolName: 'tab_action:click',
      origin: 'https://*',
      policy: 'allow',
    });
    await permissions.upsertToolPermissionPolicy({
      toolName: 'tab_action:click',
      origin: 'https://deces.matchid.io',
      policy: 'deny',
    });

    const denied = await permissions.evaluateToolPermission({
      toolName: 'tab_action:click',
      origin: 'https://deces.matchid.io/recherche',
    });
    expect(denied.allowed).toBe(false);
    expect('denied' in denied && denied.denied).toBe(true);

    const allowedByScheme = await permissions.evaluateToolPermission({
      toolName: 'tab_action:click',
      origin: 'https://example.com/page',
    });
    expect(allowedByScheme).toEqual({ allowed: true });

    const allowedByGenericRule = await permissions.evaluateToolPermission({
      toolName: 'tab_action:scroll',
      origin: 'https://example.com/page',
    });
    expect(allowedByGenericRule).toEqual({ allowed: true });
  });

  it('supports wildcard tool names, legacy tool patterns, and allow-once decision flow', async () => {
    const permissions = await importToolPermissions();
    const uuidSpy = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('perm-1')
      .mockReturnValueOnce('perm-2');

    await permissions.upsertToolPermissionPolicy({
      toolName: 'tab_read:*',
      origin: '*.matchid.io',
      policy: 'allow',
    });
    await permissions.upsertToolPermissionPolicy({
      toolName: 'tab_action',
      origin: '*',
      policy: 'allow',
    });

    const readAllowed = await permissions.evaluateToolPermission({
      toolName: 'tab_read:dom',
      origin: 'https://deces.matchid.io/recherche',
    });
    expect(readAllowed).toEqual({ allowed: true });

    const legacyAllowed = await permissions.evaluateToolPermission({
      toolName: 'tab_action:click',
      origin: 'https://another.example/path',
    });
    expect(legacyAllowed).toEqual({ allowed: true });

    const firstPrompt = await permissions.evaluateToolPermission({
      toolName: 'tab_read:elements',
      origin: 'https://no-policy.example/path',
    });
    expect(firstPrompt.allowed).toBe(false);
    expect('request' in firstPrompt).toBe(true);
    if (!('request' in firstPrompt)) {
      throw new Error('Expected a permission request payload');
    }
    expect(firstPrompt.request.requestId).toBe('perm-1');
    expect(firstPrompt.request.toolName).toBe('tab_read:elements');
    expect(firstPrompt.request.origin).toBe('https://no-policy.example');

    await permissions.applyToolPermissionDecision({
      requestId: firstPrompt.request.requestId,
      decision: 'allow_once',
    });

    const secondEval = await permissions.evaluateToolPermission({
      toolName: 'tab_read:elements',
      origin: 'https://no-policy.example/path',
    });
    expect(secondEval).toEqual({ allowed: true });

    const thirdEval = await permissions.evaluateToolPermission({
      toolName: 'tab_read:elements',
      origin: 'https://no-policy.example/path',
    });
    expect(thirdEval.allowed).toBe(false);
    expect('request' in thirdEval).toBe(true);
    if (!('request' in thirdEval)) {
      throw new Error('Expected a permission request after allow_once consumption');
    }
    expect(thirdEval.request.requestId).toBe('perm-2');

    uuidSpy.mockRestore();
  });
});
