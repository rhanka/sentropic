import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertNoQualificationLeftovers } from '../src/qualification-leftovers.js';

describe('qualification startup inventory', () => {
  it.each(['qd-aborted', 'qi-aborted', 'ports/uid', 'tenants/sentropic/bases/qual-isolation-aborted', 'copied-base'])('should refuse %s without deleting it', name => {
    const root = mkdtempSync(join(tmpdir(), 'qualification-leftovers-'));
    const release = join(root, 'release'); mkdirSync(release);
    writeFileSync(join(release, 'qualification.erofs'), 'fixture');
    const path = name === 'copied-base'
      ? join(root, 'tenants/sentropic/bases/source', `${createHash('sha256').update('fixture').digest('hex')}.erofs`)
      : join(root, name);
    try {
      expect(() => assertNoQualificationLeftovers(release, root, join(root, 'tenants'))).not.toThrow();
      mkdirSync(name === 'copied-base' ? join(path, '..') : path, { recursive: true });
      if (name === 'copied-base') writeFileSync(path, 'fixture');
      expect(() => assertNoQualificationLeftovers(release, root, join(root, 'tenants'))).toThrow('leftovers');
      expect(existsSync(path)).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
