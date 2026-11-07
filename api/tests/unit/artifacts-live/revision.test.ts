import { describe, expect, it, vi } from 'vitest';
import { fixture, key, owner } from './fixture';

describe('live revisions are opaque bounded strings end to end (review R1)', () => {
  it('should refuse an empty, over-long or numeric revision before any projection', async () => {
    const f = fixture(); await f.controller.start(key); vi.mocked(f.ports.worker.restore).mockClear();
    for (const revision of ['', 'x'.repeat(129), 7 as unknown as string]) {
      await expect(f.controller.project(key, revision)).rejects.toMatchObject({ reason: 'invalid_revision' });
    }
    expect(f.ports.worker.restore).not.toHaveBeenCalled();
  });
  it('should serve and grant a 128-character opaque revision as a string', async () => {
    const f = fixture(); f.draft().revision = 'r'.repeat(128); await f.controller.start(key);
    const grant = await f.controller.authorize(key, owner, 'read');
    expect(grant.sourceRevision).toBe('r'.repeat(128));
  });
  it('should not start from a durable draft whose revision is not a bounded string, and hold no slot', async () => {
    const f = fixture(); f.draft().revision = 'x'.repeat(129);
    await expect(f.controller.start(key)).rejects.toMatchObject({ reason: 'invalid_revision' });
    expect(f.core.create).not.toHaveBeenCalled(); expect(await f.state()).toBeUndefined();
    await expect(f.admission.acquire({ storageScopeId: 's', artifactId: 'other' }, 'bob')).resolves.toBeUndefined();
  });
});
