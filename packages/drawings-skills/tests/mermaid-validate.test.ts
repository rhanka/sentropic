import { describe, it, expect } from 'vitest';
import { mermaidPrecheck } from '../src/catalog/mermaid/precheck';
import { mermaidParse } from '../src/catalog/mermaid/parse';

describe('mermaidPrecheck (cheap, sync)', () => {
  it('accepts a known diagram keyword', () => {
    expect(mermaidPrecheck('flowchart TD\n A-->B').ok).toBe(true);
  });
  it('rejects empty source', () => {
    expect(mermaidPrecheck('   ').ok).toBe(false);
  });
  it('rejects source with no known keyword', () => {
    expect(mermaidPrecheck('hello world').ok).toBe(false);
  });
});

describe('mermaidParse (real mermaid.parse, async)', () => {
  it('accepts valid flowchart source', async () => {
    const r = await mermaidParse('flowchart TD\n  A[User] --> B[Login]');
    expect(r.ok).toBe(true);
  });
  it('rejects syntactically broken source', async () => {
    const r = await mermaidParse('flowchart TD\n  A[[[broken --');
    expect(r.ok).toBe(false);
  });
  it('rejects empty source', async () => {
    const r = await mermaidParse('   ');
    expect(r.ok).toBe(false);
  });
});
