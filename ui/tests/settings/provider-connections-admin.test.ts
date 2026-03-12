import { describe, expect, it, vi } from 'vitest';

import {
  completeCodexProviderEnrollmentWith,
  disconnectCodexProviderEnrollmentWith,
  fetchProviderConnectionsWith,
  startCodexProviderEnrollmentWith,
  type ProviderConnectionState,
} from '../../src/lib/utils/provider-connections-api';

describe('provider connections admin utils', () => {
  it('returns provider list from settings provider-connections payload', async () => {
    const providers: ProviderConnectionState[] = [
      {
        providerId: 'codex',
        label: 'Codex',
      ready: true,
      connectionStatus: 'connected',
      enrollmentId: null,
      enrollmentUrl: null,
      enrollmentCode: null,
      enrollmentExpiresAt: null,
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

  it('starts codex enrollment via admin endpoint', async () => {
    const provider: ProviderConnectionState = {
      providerId: 'codex',
      label: 'Codex',
      ready: false,
      connectionStatus: 'pending',
      enrollmentId: 'enroll_1',
      enrollmentUrl: 'https://auth.openai.com/codex/device',
      enrollmentCode: 'ABCD-EFGH',
      enrollmentExpiresAt: null,
      managedBy: 'none',
      accountLabel: 'ops@example.com',
      updatedAt: '2026-03-03T12:00:00.000Z',
      updatedByUserId: 'user_admin',
      canConfigure: true,
    };
    const requester = vi.fn().mockResolvedValue({ provider });

    const result = await startCodexProviderEnrollmentWith(
      {
        accountLabel: 'ops@example.com',
      },
      requester,
    );

    expect(requester).toHaveBeenCalledWith('/settings/provider-connections/codex/enrollment/start', {
      accountLabel: 'ops@example.com',
    });
    expect(result).toEqual(provider);
  });

  it('completes codex enrollment via admin endpoint', async () => {
    const provider: ProviderConnectionState = {
      providerId: 'codex',
      label: 'Codex',
      ready: true,
      connectionStatus: 'connected',
      enrollmentId: null,
      enrollmentUrl: null,
      enrollmentCode: null,
      enrollmentExpiresAt: null,
      managedBy: 'admin_settings',
      accountLabel: 'ops@example.com',
      updatedAt: '2026-03-03T12:00:00.000Z',
      updatedByUserId: 'user_admin',
      canConfigure: true,
    };
    const requester = vi.fn().mockResolvedValue({ provider });

    const result = await completeCodexProviderEnrollmentWith(
      {
        enrollmentId: 'enroll_1',
        accountLabel: 'ops@example.com',
      },
      requester,
    );

    expect(requester).toHaveBeenCalledWith('/settings/provider-connections/codex/enrollment/complete', {
      enrollmentId: 'enroll_1',
      accountLabel: 'ops@example.com',
    });
    expect(result).toEqual(provider);
  });

  it('disconnects codex enrollment via admin endpoint', async () => {
    const provider: ProviderConnectionState = {
      providerId: 'codex',
      label: 'Codex',
      ready: false,
      connectionStatus: 'disconnected',
      enrollmentId: null,
      enrollmentUrl: null,
      enrollmentCode: null,
      enrollmentExpiresAt: null,
      managedBy: 'none',
      accountLabel: null,
      updatedAt: '2026-03-03T12:00:00.000Z',
      updatedByUserId: 'user_admin',
      canConfigure: true,
    };
    const requester = vi.fn().mockResolvedValue({ provider });

    const result = await disconnectCodexProviderEnrollmentWith(requester);

    expect(requester).toHaveBeenCalledWith(
      '/settings/provider-connections/codex/enrollment/disconnect',
    );
    expect(result).toEqual(provider);
  });
});
