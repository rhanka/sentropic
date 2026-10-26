import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROVIDER_CATALOG } from '/source/packages/cluster-mesh/dist/modules/catalog.js';

const manifest = JSON.parse(readFileSync(new URL('./node_modules/@sentropic/llm-mesh/package.json', import.meta.url)));
assert.equal(manifest.version, '0.19.2');
const descriptors = Object.values(PROVIDER_CATALOG).filter((entry) => entry.owner === 'llm-mesh');
assert.equal(descriptors.length, 5);
for (const descriptor of descriptors) {
  const specifier = descriptor.packageName + (descriptor.subpath === '.' ? '' : descriptor.subpath.slice(1));
  const module = await import(specifier);
  const missing = descriptor.requiredMembers.filter((name) => !(name in module));
  assert.deepEqual(missing, [], `${descriptor.id}: missing required members`);
  console.log(`${descriptor.id}: PASS (@sentropic/llm-mesh@${manifest.version})`);
}
