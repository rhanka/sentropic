import { describe, it } from 'vitest';

import { InMemoryCanonicalStore } from './conformance/in-memory.js';
import { runCommentsConformance } from './conformance/comments-conformance.js';

describe('canonical comments conformance', () => {
  it('passes the full corpus against the in-memory store', async () => {
    await runCommentsConformance(new InMemoryCanonicalStore());
  });

  it('keeps every corpus case isolated per store instance', async () => {
    await runCommentsConformance(new InMemoryCanonicalStore());
    await runCommentsConformance(new InMemoryCanonicalStore());
  });
});
