// Package the compiler-emitted neutral declaration as the standalone C6 asset.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const inventory = JSON.parse(readFileSync('assets/storage/engram-memory/neutral-asset-inventory.json', 'utf8'));
const declaration = readFileSync('dist/engram-memory/neutral-contract.d.ts', 'utf8')
  .replace(/^\/\/# sourceMappingURL=.*\n?/m, '');
assert(!/^\s*(?:import|export\s+\*|export\s*\{.*\}\s*from)\b/m.test(declaration), 'C6 declaration must have no external closure');
assert.equal(createHash('sha256').update(declaration).digest('hex'), inventory.asset.declarationSha256,
  'C6 declaration bytes changed; review and update the declared hash');
mkdirSync(dirname(inventory.asset.declaration), { recursive: true });
writeFileSync(inventory.asset.declaration, declaration);
