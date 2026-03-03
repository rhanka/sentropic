import { describe, expect, it, vi } from 'vitest';

import {
  fetchProviderConnectionsWith,
  saveCodexProviderConnectionWith,
  type ProviderConnectionState,
} from '../../src/lib/utils/provider-connections-api';

describe('provider connections admin utils', () => {
  it('returns provider list from settings provider-connections payload', async () => {
    const providers: ProviderConnectionState[] = [
      {
        providerId: 'codex',
        label: 'Codex',
        ready: true,
        managedBy: 'admin_settings',
        accountLabel: 'admin@example.com',
        updatedAt: '2026-03-03T12:00:00.000Z',
        updatedByUserId: 'user_admin',
        canConfigure: true,
      },
    ];
    const requester = vi.fn().mockResolvedValue({ providers });

    const result = await fetchProviderConnectionsWith(requester);

    expect(requester).toHaveBeenCalledWith('/settings/provider-connections');
    expect(result).toEqual(providers);
  });

  it('normalizes missing providers payload to an empty list', async () => {
    const requester = vi.fn().mockResolvedValue({ providers: null });

    const result = await fetchProviderConnectionsWith(requester as any);

    expect(result).toEqual([]);
  });

  it('sends codex connection payload to admin endpoint', async () => {
    const provider: ProviderConnectionState = {
      providerId: 'codex',
      label: 'Codex',
      ready: true,
      managedBy: 'admin_settings',
      accountLabel: 'ops@example.com',
      updatedAt: '2026-03-03T12:00:00.000Z',
      updatedByUserId: 'user_admin',
      canConfigure: true,
    };
    const requester = vi.fn().mockResolvedValue({ provider });

    const result = await saveCodexProviderConnectionWith(
      {
        connected: true,
        accountLabel: 'ops@example.com',
      },
      requester,
    );

    expect(requester).toHaveBeenCalledWith('/settings/provider-connections/codex', {
      connected: true,
      accountLabel: 'ops@example.com',
    });
    expect(result).toEqual(provider);
  });
});
