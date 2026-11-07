import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.env.HONO_TREE_ROOT ?? '/workspace';
const copies = [];
function scan(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    if (child.endsWith('/node_modules/@hono/node-server')) copies.push(child);
    scan(child);
  }
}
scan(`${root}/node_modules`);
for (const dir of ['api', 'apps', 'packages']) scan(`${root}/${dir}`);
assert.deepEqual(copies, [`${root}/node_modules/@hono/node-server`], 'exactly one physical runtime adapter must be retained');
assert.equal(JSON.parse(fs.readFileSync(`${copies[0]}/package.json`)).version, '2.1.6');
for (const role of ['api', 'apps/artifact-content']) {
  const require = createRequire(`${root}/${role}/package.json`);
  const resolved = fs.realpathSync(require.resolve('@hono/node-server'));
  assert.ok(resolved.startsWith(`${copies[0]}/`), `${role} resolves outside the retained copy: ${resolved}`);
  console.log(`${role}: ${resolved} (2.1.6)`);
}
