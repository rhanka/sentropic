// memory dependency pin ownership (Astra R1 finding 4): the root lock
// pins file-type 22.1.0 because the BUG-3 regression test requires the
// zip-sniffing behavior that 22.2.0 fixed away. A stacked parent-scoped
// override cannot enforce this: npm resolves overrides against the
// pre-resolution tree, so a scope that only exists through another
// override never chains (fresh resolution yields 22.2.0). The pin is
// therefore owned as a lock-only selection, guarded here.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readRootJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8')) as Record<string, unknown>;

describe('memory dependency pin ownership', () => {
  it('should pin file-type 22.1.0 in the root lock for the BUG-3 zip trigger', () => {
    const lock = readRootJson('package-lock.json') as {
      packages: Record<string, { version?: string }>;
    };
    expect(lock.packages['node_modules/file-type']?.version).toBe('22.1.0');
  });

  it('should not declare ineffective stacked override scopes', () => {
    const pkg = readRootJson('package.json') as { overrides?: Record<string, unknown> };
    expect(pkg.overrides ?? {}, 'stacked officeparser@8.2.0 scope never chains; the file-type pin is lock-only').not.toHaveProperty(
      'officeparser@8.2.0',
    );
  });
});
