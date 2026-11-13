import { mkdtempSync, readFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeSource } from '../src/source-write.js';

describe('agent-mediated source writes', () => {
  it('should write allowed source and reject refused files and links on disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'write-'));
    const scope = { kind: 'ui' as const, writable: ['ui/**'], refused: ['ui/dist/**', '**/package*.json'],
      source: { repo: 'fixture', path: 'registry.ts', commit: 'abc' } };
    try {
      writeSource(root, '/workspace/ui/src/new.ts', Buffer.from('export {}'), scope);
      expect(readFileSync(join(root, 'ui/src/new.ts'), 'utf8')).toBe('export {}');
      expect(() => writeSource(root, '/workspace/ui/package.json', Buffer.from('{}'), scope)).toThrow();
      mkdirSync(join(root, 'ui/dist')); symlinkSync('/etc', join(root, 'ui/link'));
      expect(() => writeSource(root, '/workspace/ui/link/passwd', Buffer.from('x'), scope)).toThrow();
      expect(() => writeSource(root, '/workspace/ui/dist/index.html', Buffer.from('x'), scope)).toThrow();
    } finally { rmSync(root, { recursive: true }); }
  });
});
