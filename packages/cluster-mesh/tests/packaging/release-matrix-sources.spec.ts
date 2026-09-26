import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectedSource, siblingIndex, type SiblingIndexEntry } from './helpers.js';

// Expected per-package source of the packed release matrix, derived from the siblings index prepare.sh wrote
// (never from the mere presence of CLUSTER_MESH_SIBLING_RECEIPTS): an empty receipts file or a single sibling
// leaves the other train packages on the registry.
const MESH: SiblingIndexEntry = { name: '@sentropic/llm-mesh', version: '0.22.0' };
const GATEWAY: SiblingIndexEntry = { name: '@sentropic/llm-gateway', version: '0.19.0' };
const CANDIDATE: SiblingIndexEntry = { name: '@sentropic/cluster-mesh', version: '0.13.0' };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cluster-sources-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sources = (entries: readonly SiblingIndexEntry[] | undefined) => {
  if (entries) writeFileSync(join(dir, 'index.json'), JSON.stringify(entries));
  const index = siblingIndex(dir);
  return [MESH, GATEWAY].map(({ name, version }) => expectedSource(index, name, version));
};

describe('packed release matrix expected sources', () => {
  it('should expect the registry for both packages without a siblings index (registry run)', () => {
    expect(sources(undefined)).toEqual(['registry', 'registry']);
  });

  it('should expect the registry for both packages with an empty receipts file', () => {
    expect(sources([])).toEqual(['registry', 'registry']);
  });

  it('should expect a sibling only for llm-mesh when only llm-mesh has a receipt', () => {
    expect(sources([MESH, CANDIDATE])).toEqual(['sibling', 'registry']);
  });

  it('should expect a sibling only for llm-gateway when only llm-gateway has a receipt', () => {
    expect(sources([GATEWAY])).toEqual(['registry', 'sibling']);
  });

  it('should expect siblings for both packages when both have receipts', () => {
    expect(sources([MESH, GATEWAY, CANDIDATE])).toEqual(['sibling', 'sibling']);
  });

  it('should expect the registry for a sibling at another version than the pinned one', () => {
    expect(sources([{ ...MESH, version: '0.22.1' }, GATEWAY])).toEqual(['registry', 'sibling']);
  });
});
