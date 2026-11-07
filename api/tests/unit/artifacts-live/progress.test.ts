import { describe, expect, it } from 'vitest';
import { fixture, key } from './fixture';
import { recordHead } from '../../../src/services/artifacts/live/records';

describe('durable publication progress', () => {
  it('should deduplicate unchanged heads, own echoes and event replays', async () => {
    const f = fixture(); await f.controller.start(key);
    await f.ports.store.transaction(key, async unit => {
      const progress = unit.state!.progress;
      recordHead(progress, 'B', 'own-echo'); recordHead(progress, 'C', 'event-C');
      recordHead(progress, 'C', 'echo-C'); recordHead(progress, 'D', 'event-C');
      expect(progress.progressSeq).toBe(1); expect(progress.latestVerifiedHeadSha).toBe('C');
    });
  });
  it('should not inherit pending eligibility into a new generation', async () => {
    const f = fixture(); f.binding.initialUnpublishedBranchEligible = true; const live = await f.controller.start(key);
    await f.controller.stop(key, { ownerId: 'owner', sessionId: live.sessionId, generation: 1 });
    f.binding.generation = 2; f.binding.initialUnpublishedBranchEligible = false; f.draft().generation = 2;
    await f.controller.start(key); expect((await f.state())?.progress).toMatchObject({ generation: 2,
      progressSeq: 0, publicationBaselineSeq: 0, initialUnpublishedBranchEligible: false });
  });
});
