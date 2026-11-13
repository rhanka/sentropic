import { describe, expect, it } from 'vitest';
import { mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareIsolationFixture } from '../src/isolation-qualification.js';

describe('real isolation fixture permissions', () => {
  it.each([0o022, 0o077])('should leave DAC writable markers under umask %i so only the mount can reject writes', mask => {
    const root = mkdtempSync(join(tmpdir(), 'isolation-fixture-'));
    const previous = process.umask(mask);
    try {
      const fixture = prepareIsolationFixture(root);
      expect(statSync(fixture).mode & 0o777).toBe(0o777);
      expect(statSync(join(fixture, 'isolation-marker')).mode & 0o777).toBe(0o666);
    } finally { process.umask(previous); rmSync(root, { recursive: true }); }
  });
});
