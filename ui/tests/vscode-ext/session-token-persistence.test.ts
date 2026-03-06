import { describe, expect, it } from 'vitest';

import { resolvePersistedVsCodeSessionToken } from '../../vscode-ext/session-token-persistence';

describe('vscode session token persistence', () => {
  it('prefers secret storage when available', () => {
    expect(
      resolvePersistedVsCodeSessionToken({
        secretToken: 'secret-token',
        persistedToken: 'persisted-token',
        settingToken: 'setting-token',
      }),
    ).toBe('secret-token');
  });

  it('falls back to persisted runtime state when secret storage is empty', () => {
    expect(
      resolvePersistedVsCodeSessionToken({
        secretToken: '',
        persistedToken: 'persisted-token',
        settingToken: 'setting-token',
      }),
    ).toBe('persisted-token');
  });

  it('falls back to configuration setting when no other storage is available', () => {
    expect(
      resolvePersistedVsCodeSessionToken({
        secretToken: '',
        persistedToken: '',
        settingToken: 'setting-token',
      }),
    ).toBe('setting-token');
  });

  it('returns empty string when all sources are empty', () => {
    expect(
      resolvePersistedVsCodeSessionToken({
        secretToken: '',
        persistedToken: '',
        settingToken: '',
      }),
    ).toBe('');
  });
});
