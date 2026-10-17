import { describe, expect, it, vi } from 'vitest';
import { ConsentFlow, createOffer, retentionChoice, viewAccess } from '$lib/session-content/state';
import fr from '../../src/locales/fr.json';

const scope = { ownerId: 'owner', workspaceId: 'workspace', projectId: 'project', sourceId: 'source' };

describe('owner-controlled retention', () => {
  it('should default to no expiry independently for each project and retained channel', () => {
    const first = createOffer(scope);
    first.retentionByChannel['terminal.cache'] = retentionChoice('duration', 2, 'hours');
    expect(first.retentionByChannel['terminal.cache']).toEqual({ mode: 'duration', durationSeconds: 7200 });
    expect(first.retentionByChannel['native.mirror']).toEqual({ mode: 'none' });
    expect(createOffer({ ...scope, projectId: 'second' }).retentionByChannel['terminal.cache'])
      .toEqual({ mode: 'none' });
  });

  it.each([0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER])(
    'should refuse an invalid duration %s', (duration) => {
      expect(() => retentionChoice('duration', duration, 'days')).toThrow();
    },
  );

  it('should invalidate the exact prepared policy when a retention choice changes', async () => {
    const prepare = vi.fn(async (offer) => ({ offer, expiresAt: Date.now() + 1000 }));
    const accept = vi.fn();
    const flow = new ConsentFlow(createOffer(scope), {
      prepare, accept, prove: vi.fn(), available: () => true,
    });
    await flow.prepare();
    expect(prepare.mock.calls[0][0].retentionByChannel).toEqual(createOffer(scope).retentionByChannel);
    flow.edit({ ...flow.offer, retentionByChannel: {
      ...flow.offer.retentionByChannel, 'native.mirror': retentionChoice('duration', 1, 'days'),
    } });
    await flow.confirm();
    expect(flow.prepared).toBeNull();
    expect(accept).not.toHaveBeenCalled();
  });

  it('should preserve expiry and stored reads while the source is offline or capture is full', () => {
    const copy = { ...scope, status: 'attached' as const, excluded: false, sourceAvailable: false,
      retained: true, storedAuthorized: true, historyAuthorized: false, liveAuthorized: false,
      expiresAt: 123, projectRevision: 2, grantProjectRevision: 2, pauseReason: 'quota_exceeded' };
    expect(viewAccess(copy, scope, 100)).toMatchObject({ stored: true, live: false });
    expect(copy.expiresAt).toBe(123);
    expect(viewAccess(copy, scope, 124).stored).toBe(false);
  });

  it('should disclose every purge, closed-history and unbounded offline revocation consequence', () => {
    const disclosure = fr.sessionContent.disclosures.join(' ');
    for (const phrase of ['sans expiration', 'restauration', 'illisibles', 'désactivation',
      'compte', 'purge', 'sans être membre', 'paramètres', "n'a pas de limite",
      'autorisation de lecture historique distincte', 'ne prolonge pas']) {
      expect(disclosure).toContain(phrase);
    }
  });
});
