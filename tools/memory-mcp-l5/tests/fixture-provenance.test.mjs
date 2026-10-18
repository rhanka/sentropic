import { describe, it, expect } from 'vitest';
import { FROZEN_SPEC_SHA256, checkFixtureProvenance } from '../receipt.mjs';

const H64 = 'e'.repeat(64);
const C40 = '7c717e47e213a79b6180f3f737e11bbec5140cd2';

function makeValidFixtureIndex() {
  return {
    specSha256: FROZEN_SPEC_SHA256,
    l0Commit: C40,
    coOwnerReceiptSha256: H64,
    files: [
      {
        path: 'tools/memory-mcp-l5/fixtures/l0/7c717e47e213a79b6180f3f737e11bbec5140cd2/memory-mcp-spec-rules.ts',
        upstreamPath: 'tests/fixtures/memory-mcp-spec-rules.ts',
        sha256: H64,
      },
    ],
  };
}

describe('L5 fixture provenance index contract', () => {
  it('accepts a valid provenance-bound L0 fixture index', () => {
    expect(checkFixtureProvenance(makeValidFixtureIndex())).toEqual([]);
  });

  it('rejects wrong spec digest, bad L0 commit, missing co-owner receipt, duplicate paths, and traversal', () => {
    expect(checkFixtureProvenance({ ...makeValidFixtureIndex(), specSha256: H64 }).join(' ')).toMatch(/frozen v3\.1 digest/);
    expect(checkFixtureProvenance({ ...makeValidFixtureIndex(), l0Commit: 'short' }).join(' ')).toMatch(/l0Commit/);
    expect(checkFixtureProvenance({ ...makeValidFixtureIndex(), coOwnerReceiptSha256: 'bad' }).join(' ')).toMatch(/coOwnerReceiptSha256/);

    const dup = makeValidFixtureIndex();
    dup.files.push({ ...dup.files[0] });
    expect(checkFixtureProvenance(dup).join(' ')).toMatch(/duplicate path/);

    const trav = makeValidFixtureIndex();
    trav.files[0].upstreamPath = '../graphify/tests/fixtures/memory-mcp-spec-rules.ts';
    expect(checkFixtureProvenance(trav).join(' ')).toMatch(/invalid entry/);
  });
});
