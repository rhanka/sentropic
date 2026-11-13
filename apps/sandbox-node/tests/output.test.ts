import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readOutput } from '../src/output.js';

describe('quiescent output reader', () => {
  it('should archive output with byte bounds and reject links and path substitution', () => {
    const root = mkdtempSync(join(tmpdir(), 'output-'));
    try {
      writeFileSync(join(root, 'index.html'), '<h1>built</h1>');
      expect(readOutput(root, 'ui/dist', 32_768).length).toBeGreaterThan(0);
      expect(() => readOutput(root, '../etc', 32_768)).toThrow();
      expect(() => readOutput(root, 'ui/dist', 10)).toThrow();
      symlinkSync('/etc/passwd', join(root, 'link'));
      expect(() => readOutput(root, 'ui/dist', 32_768)).toThrow();
    } finally { rmSync(root, { recursive: true }); }
  });
});
