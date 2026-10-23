import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { startPortableDigest, updatePortableDigest, finishPortableDigest, type PortableDigestState } from '../../src/storage/postgres/digest.js';

describe('durable SHA-256 context qualification', () => {
  it.each([1, 7, 63, 64, 65, 127])('should restore a JSON-persisted context across %s-byte chunks', (size) => {
    const bytes = Buffer.from(JSON.stringify(['staged-effect-root', 'v1', Array.from({ length: 100 }, (_, n) => [n, `escape-\\-\"-🙂-${n}`])]), 'utf8');
    let state = startPortableDigest();
    for (let offset = 0; offset < bytes.length; offset += size) {
      state = updatePortableDigest(JSON.parse(JSON.stringify(state)) as PortableDigestState, bytes.subarray(offset, offset + size));
    }
    expect(finishPortableDigest(JSON.parse(JSON.stringify(state)) as PortableDigestState)).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
  it('should preserve independent branches from one saved prefix', () => {
    const prefix = updatePortableDigest(startPortableDigest(), Buffer.from('prefix-🙂'));
    for (const tail of ['a', 'b']) {
      const result = updatePortableDigest(prefix, Buffer.from(tail));
      expect(finishPortableDigest(result)).toBe(createHash('sha256').update(`prefix-🙂${tail}`).digest('hex'));
    }
    expect(finishPortableDigest(prefix)).toBe(createHash('sha256').update('prefix-🙂').digest('hex'));
  });
  it('should refuse corrupt or incompatible backend contexts without fabricating a digest', () => {
    const state = updatePortableDigest(startPortableDigest(), Buffer.from('abc'));
    for (const changed of [{ ...state, bytesHashed: -1 }, { ...state, words: [1] }, { ...state, remainder: 'invalid base64!' }, { ...state, version: 'unknown' }]) {
      expect(() => finishPortableDigest(changed as PortableDigestState)).toThrow();
    }
  });
});
