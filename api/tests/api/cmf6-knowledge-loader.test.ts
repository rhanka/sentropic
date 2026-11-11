import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKnowledgeStore, verifyKnowledgeBytes, verifyKnowledgeDescriptor } from '../../src/services/artifacts/knowledge-loader';

const digestOf = (text: string): string => createHash('sha256').update(Buffer.from(text)).digest('hex');
function descriptorFor(text: string) {
  return { repoId: 'rhanka/radar-immobilier', commitSha: 'a'.repeat(40), path: 'artifact-knowledge', digest: digestOf(text) };
}

afterEach(() => {
  delete process.env.CM_KNOWLEDGE_ENABLED;
});

describe('CMF-6 knowledge loader', () => {
  it('should refuse a non-pinned commit and a bad digest', () => {
    expect(verifyKnowledgeDescriptor({ ...descriptorFor('x'), commitSha: 'abc' }).ok).toBe(false);
    expect(verifyKnowledgeBytes(descriptorFor('hello'), Buffer.from('other')).ok).toBe(false);
  });
  it('should validate the descriptor before fetching', async () => {
    process.env.CM_KNOWLEDGE_ENABLED = '1';
    try {
      const store = createKnowledgeStore();
      const fetch = vi.fn(async () => Buffer.from('pack-v1'));
      await expect(store.load({ ...descriptorFor('pack-v1'), commitSha: 'short' }, fetch)).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
      await expect(store.load({ ...descriptorFor('pack-v1'), path: '../escape' }, fetch)).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      delete process.env.CM_KNOWLEDGE_ENABLED;
    }
  });
  it('should serve the verified bundle without refetching when cached', async () => {
    process.env.CM_KNOWLEDGE_ENABLED = '1';
    try {
      const store = createKnowledgeStore();
      const descriptor = descriptorFor('pack-v1');
      const firstFetch = vi.fn(async () => Buffer.from('pack-v1'));
      await store.load(descriptor, firstFetch);
      expect(firstFetch).toHaveBeenCalledTimes(1);
      const secondFetch = vi.fn(async () => { throw new Error('github_unreachable'); });
      const served = await store.load(descriptor, secondFetch);
      expect(Buffer.from(served).toString()).toBe('pack-v1');
      expect(secondFetch).not.toHaveBeenCalled();
    } finally {
      delete process.env.CM_KNOWLEDGE_ENABLED;
    }
  });
  it('should refuse a digest mismatch and keep the previous revision', async () => {
    process.env.CM_KNOWLEDGE_ENABLED = '1';
    try {
      const store = createKnowledgeStore();
      const good = descriptorFor('pack-v1');
      await store.load(good, async () => Buffer.from('pack-v1'));
      await expect(store.load({ ...good, digest: 'b'.repeat(64) }, async () => Buffer.from('pack-v1')))
        .rejects.toThrow();
      expect(store.get(good)?.length).toBeGreaterThan(0);
    } finally {
      delete process.env.CM_KNOWLEDGE_ENABLED;
    }
  });
});
