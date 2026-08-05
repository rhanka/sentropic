import { describe, expect, it } from 'vitest';
import {
  createLlmMeshFacade,
  type ConfigResolver,
  type FacadeOptions,
  type KeyringAdapter,
  type LlmMeshFacade,
} from '../../src/service/facade.js';

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
    expect(typeof facade.acquire).toBe('function');
    expect(typeof facade.release).toBe('function');
    expect(typeof facade.getAdapter).toBe('function');
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
});
