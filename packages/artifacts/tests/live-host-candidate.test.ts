import { describe, expect, it } from 'vitest';
import { CANDIDATE_LIMITS, candidateDigest, candidatePath } from '../src/live-host/candidate.js';

const file = (path: string, text: string) => ({ path, bytes: Buffer.from(text) });

describe('live-host candidate digest (A-LIVE 8.3)', () => {
  it('matches the pinned vectors, independent of input order and file modes', () => {
    const files = [file('index.html', '<p>B</p>'), file('assets/a.js', '1')];
    const vector = 'd839cdc66c5326be627f52ac9881e12c54cb843e16e793bb756126665c6ecafb';
    expect(candidateDigest(files)).toBe(vector);
    expect(candidateDigest([...files].reverse())).toBe(vector);
    expect(candidateDigest(files.map(f => ({ ...f, mode: 0o755 })))).toBe(vector);
  });
  it('sorts by UTF-16 code units, hashes UTF-8 JSON and escapes quotes', () => {
    const files = [file('～.txt', 'x'), file('😀.txt', 'x'), file('é.txt', 'x'), file('a"q.txt', 'x'), file('Z.txt', '')];
    expect(candidateDigest(files)).toBe('1a0f828012df938130159bc1ad8c32b2511e81b2e89277cc3a3204c83c255db3');
  });
  it('binds every path, size and byte', () => {
    const base = candidateDigest([file('a.js', '1')]);
    for (const other of [[file('b.js', '1')], [file('a.js', '2')], [file('a.js', '11')]]) {
      expect(candidateDigest(other)).not.toBe(base);
    }
  });
  it('enforces the output ceilings', () => {
    const many = Array.from({ length: CANDIDATE_LIMITS.files + 1 }, (_, i) => file(`f${i}`, 'x'));
    expect(() => candidateDigest(many.slice(0, CANDIDATE_LIMITS.files))).not.toThrow();
    expect(() => candidateDigest(many)).toThrow('candidate_invalid');
    expect(() => candidateDigest([])).toThrow('candidate_invalid');
    const big = { path: 'big', bytes: new Uint8Array(CANDIDATE_LIMITS.fileBytes + 1) };
    expect(() => candidateDigest([big])).toThrow('candidate_invalid');
    const full = Array.from({ length: 4 }, (_, i) => ({ path: `p${i}`, bytes: new Uint8Array(CANDIDATE_LIMITS.fileBytes) }));
    expect(() => candidateDigest(full)).not.toThrow();
    expect(() => candidateDigest([...full, file('one-more', 'x')])).toThrow('candidate_invalid');
  });
  it('refuses unsafe, duplicate and file-versus-directory paths', () => {
    for (const path of ['../x', '/x', 'a//b', 'a/', 'a\\b', '.', '', 'a/./b', 'a\u0000b', 'a\nb', '\ud800', 'x'.repeat(1025)]) {
      expect(candidatePath(path)).toBe(false);
      expect(() => candidateDigest([file(path, '')])).toThrow('candidate_invalid');
    }
    expect(() => candidateDigest([file('a.js', '1'), file('a.js', '1')])).toThrow('candidate_invalid');
    expect(() => candidateDigest([file('a', '1'), file('a/b.js', '1')])).toThrow('candidate_invalid');
    expect(() => candidateDigest([file('x/a', '1'), file('x/a/b/c', '1')])).toThrow('candidate_invalid');
    expect(() => candidateDigest([{ path: 'a', bytes: 'text' as unknown as Uint8Array }])).toThrow('candidate_invalid');
    expect(candidatePath('assets/Logo final é.png')).toBe(true);
  });
});
