import { describe, expect, it } from 'vitest';
import { InMemoryKeyring } from '../../src/node/keyring/in-memory-keyring.js';
import {
  createLlmMeshFacade,
  type ConfigResolver,
  type FacadeOptions,
  type KeyringAdapter,
  type LlmMeshFacade,
} from '../../src/service/facade.js';

const seedPersistedAccount = async (
  keyring: KeyringAdapter,
  accountId: string,
  ownerScopeRef: string,
): Promise<void> => {
  const createdAt = '2026-08-20T10:00:00.000Z';
  const accountLabel = `${ownerScopeRef} Codex`;
  await keyring.setSecret(`sentropic-llm-mesh:${accountId}:public`, JSON.stringify({
    accountId, accountLabel, providerId: 'codex', status: 'active', createdAt,
    updatedAt: createdAt,
    account: {
      accountId, ownerScopeRef, accountLabel, targetProviderId: 'openai',
      transportProviderId: 'codex', status: 'active', enrollmentCompletedAt: createdAt,
    },
  }));
  await keyring.setSecret(`sentropic-llm-mesh:${accountId}:envelope`, JSON.stringify({
    accountId, accessToken: `secret-${accountId}`,
    expiresAt: '2099-01-01T00:00:00.000Z', authClientConfigVersion: 'v1.0.0',
  }));
};

describe('LlmMeshFacade', () => {
  it('creates a facade instance with valid options', () => {
    const mockConfigResolver: ConfigResolver = {
      async resolveConfig(configRef) {
        return { ref: configRef };
      },
    };

    const mockKeyring: KeyringAdapter = {
      async getSecret() {
        return null;
      },
      async setSecret() {},
      async deleteSecret() {},
    };

    const options: FacadeOptions = {
      configResolver: mockConfigResolver,
      keyring: mockKeyring,
      mode: 'cli',
    };

    const facade: LlmMeshFacade = createLlmMeshFacade(options);

    expect(facade).toBeDefined();
    expect(typeof facade.enroll).toBe('function');
    expect(typeof facade.waitForCallback).toBe('function');
    expect(typeof facade.pollForCompletion).toBe('function');
    expect(typeof facade.cancel).toBe('function');
    expect(typeof facade.listAccounts).toBe('function');
    expect(typeof facade.removeAccount).toBe('function');
    expect(typeof facade.acquire).toBe('function');
    expect(typeof facade.release).toBe('function');
    expect(typeof facade.getAdapter).toBe('function');
    expect(typeof facade.createRoutePlanner).toBe('function');
  });

  it('throws an error if options is missing', () => {
    expect(() => createLlmMeshFacade(undefined as unknown as FacadeOptions)).toThrow(
      'LlmMeshFacade: options is required',
    );
  });

  it('delegates enroll and getAdapter to registered providers and adapters', async () => {
    const mockConfigResolver: ConfigResolver = {
      async resolveConfig() {
        return {};
      },
    };

    const facade = createLlmMeshFacade({
      configResolver: mockConfigResolver,
      mode: 'portal',
    });

    const session = await facade.enroll('cloud-code', {
      configRef: 'ref',
      mode: 'portal',
      redirectUri: 'https://localhost/cb',
      ownerScope: 'test',
    });
    expect(session.kind).toBe('authorization-url');

    await expect(
      facade.enroll('claude-code', {
        configRef: 'ref',
        mode: 'portal',
        redirectUri: 'https://localhost/cb',
        ownerScope: 'test',
      }),
    ).rejects.toThrow('UNSUPPORTED');

    const adapter = facade.getAdapter('cloud-code');
    expect(adapter).toBeDefined();
    expect(typeof adapter.execute).toBe('function');

    expect(() => facade.getAdapter('codex')).toThrow('not available locally');
  });

  it('lists and removes accounts only within the explicit owner scope', async () => {
    const keyring = new InMemoryKeyring();
    const createdAt = '2026-08-20T10:00:00.000Z';
    await keyring.setSecret(
      'sentropic-llm-mesh:accounts:index',
      JSON.stringify(['acct-owner-a', 'acct-owner-b']),
    );
    await seedPersistedAccount(keyring, 'acct-owner-a', 'owner-a');
    await seedPersistedAccount(keyring, 'acct-owner-b', 'owner-b');

    const facade = createLlmMeshFacade({
      configResolver: { async resolveConfig() { return {}; } },
      keyring,
      mode: 'cli',
    });

    const accounts = await facade.listAccounts({ ownerScope: 'owner-a' });
    expect(accounts).toEqual([{
      accountId: 'acct-owner-a',
      accountLabel: 'owner-a Codex',
      providerId: 'codex',
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    }]);
    expect(JSON.stringify(accounts)).not.toContain('secret-acct-owner-a');
    await expect(facade.removeAccount('acct-owner-b', { ownerScope: 'owner-a' }))
      .rejects.toThrow("Account 'acct-owner-b' not found");

    await expect(facade.removeAccount('acct-owner-a', { ownerScope: 'owner-a' }))
      .resolves.toEqual({ accountId: 'acct-owner-a', removed: true });
    await expect(keyring.getSecret('sentropic-llm-mesh:acct-owner-a:public'))
      .resolves.toBeNull();
    await expect(keyring.getSecret('sentropic-llm-mesh:acct-owner-a:envelope'))
      .resolves.toBeNull();
    await expect(keyring.getSecret('sentropic-llm-mesh:accounts:index'))
      .resolves.toBe(JSON.stringify(['acct-owner-a', 'acct-owner-b']));
    await expect(facade.acquire({
      ownerScopeRef: 'owner-a',
      targetProviderId: 'openai',
      transportProviderId: 'codex',
    })).rejects.toThrow('No active codex account transport for openai');
  });

  it('keeps a failed removal retryable and fail-closed across restart', async () => {
    const store = new InMemoryKeyring();
    let rejectEnvelopeDelete = true;
    const keyring: KeyringAdapter = {
      getSecret: (key) => store.getSecret(key),
      setSecret: (key, secret) => store.setSecret(key, secret),
      async deleteSecret(key) {
        if (rejectEnvelopeDelete && key.endsWith(':envelope')) {
          rejectEnvelopeDelete = false;
          throw new Error('injected keyring failure');
        }
        await store.deleteSecret(key);
      },
    };
    await keyring.setSecret(
      'sentropic-llm-mesh:accounts:index',
      JSON.stringify(['acct-owner-a']),
    );
    await seedPersistedAccount(keyring, 'acct-owner-a', 'owner-a');
    const options = {
      configResolver: { async resolveConfig() { return {}; } }, keyring, mode: 'cli' as const,
    };
    const facade = createLlmMeshFacade(options);

    await expect(facade.removeAccount('acct-owner-a', { ownerScope: 'owner-a' }))
      .rejects.toThrow('injected keyring failure');
    const restarted = createLlmMeshFacade(options);
    await expect(restarted.acquire({
      ownerScopeRef: 'owner-a', targetProviderId: 'openai', transportProviderId: 'codex',
    })).rejects.toThrow('No active codex account transport for openai');

    await expect(restarted.removeAccount('acct-owner-a', { ownerScope: 'owner-a' }))
      .resolves.toEqual({ accountId: 'acct-owner-a', removed: true });
    await expect(restarted.listAccounts({ ownerScope: 'owner-a' })).resolves.toEqual([]);
  });
});
