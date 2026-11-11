import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createKnowledgeStore, verifyKnowledgeBytes, verifyKnowledgeDescriptor } from '../src/services/artifacts/knowledge-loader';

const digestOf = (text: string): string => createHash('sha256').update(Buffer.from(text)).digest('hex');
function descriptorFor(text: string) {
  return { repoId: 'rhanka/radar-immobilier', commitSha: 'a'.repeat(40), path: 'artifact-knowledge', digest: digestOf(text) };
}

describe('CMF-6 knowledge loader', () => {
  it('should refuse a non-pinned commit and a bad digest', () => {
    expect(verifyKnowledgeDescriptor({ ...descriptorFor('x'), commitSha: 'abc' }).ok).toBe(false);
    expect(verifyKnowledgeBytes(descriptorFor('hello'), Buffer.from('other')).ok).toBe(false);
  });
  it('should serve the stored bundle when GitHub is unreachable', async () => {
    process.env.CM_KNOWLEDGE_ENABLED = '1';
    const store = createKnowledgeStore();
    const descriptor = descriptorFor('pack-v1');
    await store.load(descriptor, async () => Buffer.from('pack-v1'));
    const served = await store.load(descriptor, async () => { throw new Error('github_unreachable'); });
    expect(Buffer.from(served).toString()).toBe('pack-v1');
    delete process.env.CM_KNOWLEDGE_ENABLED;
  });
  it('should refuse a digest mismatch and keep the previous revision', async () => {
    process.env.CM_KNOWLEDGE_ENABLED = '1';
    const store = createKnowledgeStore();
    const good = descriptorFor('pack-v1');
    await store.load(good, async () => Buffer.from('pack-v1'));
    await expect(store.load({ ...good, digest: 'b'.repeat(64) }, async () => Buffer.from('pack-v1')))
      .rejects.toThrow();
    expect(store.get(good)?.length).toBeGreaterThan(0);
    delete process.env.CM_KNOWLEDGE_ENABLED;
  });
});
