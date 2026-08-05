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

  it('stub methods throw Not Implemented errors for unhandled operations', async () => {
    const mockConfigResolver: ConfigResolver = {
      async resolveConfig() {
        return {};
      },
    };

    const facade = createLlmMeshFacade({
      configResolver: mockConfigResolver,
      mode: 'cli',
    });

    await expect(
      facade.enroll('cloud-code', {
        configRef: 'ref',
        mode: 'cli',
        redirectUri: 'http://localhost',
        ownerScope: 'test',
      }),
    ).rejects.toThrow('Not implemented');

    await expect(facade.waitForCallback('enr_1')).rejects.toThrow('Not implemented');
    await expect(facade.pollForCompletion('enr_2')).rejects.toThrow('Not implemented');
    await expect(facade.cancel('enr_3')).resolves.toBeUndefined();

    expect(() => facade.getAdapter('cloud-code')).toThrow('Not implemented');
  });
});
