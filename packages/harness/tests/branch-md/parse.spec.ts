import { describe, expect, it } from 'vitest';
import { parseBranchMd } from '../../src/branch-md/parse.js';

const FIXTURE = `# Feature: BR-99 — demo branch

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: \`packages/demo/**\`, \`BRANCH.md\`
- **Forbidden Paths**: \`api/**\`, \`ui/**\`
- **Conditional Paths (exception required)**:
  - \`Makefile\` (demo lane) → **BR99-EX1**
  - \`.github/workflows/ci.yml\` → **BR99-EX2**

## Feedback Loop
- **BR99-EX1** attention — Makefile additive.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Scaffold**
  - [x] create package
  - [ ] gate green
- [ ] **Lot 1 — Logic**
  - [ ] write parser
`;

describe('parseBranchMd', () => {
  it('extracts title, scope buckets, exceptions and lots', () => {
    const p = parseBranchMd(FIXTURE);
    expect(p.title).toBe('BR-99 — demo branch');
    expect(p.allowedPaths).toEqual(['packages/demo/**', 'BRANCH.md']);
    expect(p.forbiddenPaths).toEqual(['api/**', 'ui/**']);
    expect(p.conditionalPaths).toEqual(['Makefile', '.github/workflows/ci.yml']);
    expect(p.exceptions).toEqual(['BR99-EX1', 'BR99-EX2']);
    expect(p.lots).toHaveLength(2);
    expect(p.lots[0].title).toContain('Lot 0');
    expect(p.lots[0].checked).toBe(true);
    expect(p.lots[0].items).toEqual([
      { text: 'create package', checked: true },
      { text: 'gate green', checked: false },
    ]);
    expect(p.lots[1].checked).toBe(false);
  });

  it('parses the CANONICAL template headings (parenthetical suffix) — regression for the silent-empty-scope bug', () => {
    // plan/BRANCH_TEMPLATE.md (and every real BRANCH.md) writes the bucket headings
    // with a parenthetical suffix, so the closing `**` is NOT adjacent to "Paths".
    // The parser must still extract the globs (it previously returned empty → in-scope
    // files wrongly classified as `unknown`; C2 being advisory hid it).
    const CANON = `# Feature: BR-99 — canon

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - \`src/**\`
  - \`BRANCH.md\`
- **Forbidden Paths (must not change in this branch)**:
  - \`Makefile\`
  - \`docker-compose*.yml\`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - \`.github/workflows/**\`
`;
    const p = parseBranchMd(CANON);
    expect(p.allowedPaths).toEqual(['src/**', 'BRANCH.md']);
    expect(p.forbiddenPaths).toEqual(['Makefile', 'docker-compose*.yml']);
    expect(p.conditionalPaths).toEqual(['.github/workflows/**']);
  });

  it('returns an empty structure for malformed input (no throw)', () => {
    const p = parseBranchMd('garbage\n\nno headings here');
    expect(p.title).toBe('');
    expect(p.allowedPaths).toEqual([]);
    expect(p.forbiddenPaths).toEqual([]);
    expect(p.conditionalPaths).toEqual([]);
    expect(p.lots).toEqual([]);
    expect(p.exceptions).toEqual([]);
  });
});
