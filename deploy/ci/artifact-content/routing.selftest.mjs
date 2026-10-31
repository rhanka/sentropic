import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { object } from './bundle-checks.mjs';

// Load the actual parser and UUID contract without installing a transpiler or changing sources.
const compiled = mkdtempSync(join(tmpdir(), 'content-routing-'));
let parseContentHost;
try {
  mkdirSync(join(compiled, 'content'));
  writeFileSync(join(compiled, 'package.json'), '{"type":"module"}');
  for (const file of ['contracts', 'content/routing']) {
    writeFileSync(join(compiled, `${file}.js`), stripTypeScriptTypes(readFileSync(`/routing/${file}.ts`, 'utf8')));
  }
  ({ parseContentHost } = await import(pathToFileURL(join(compiled, 'content/routing.js')).href));
} finally { rmSync(compiled, { recursive: true, force: true }); }

export function checkReservedHosts(objects) {
  const domain = object(objects, 'ConfigMap', 'artifact-content').data.APP_ARTIFACT_CONTENT_BASE_DOMAIN;
  for (const label of ['preprod', 'pinned', 'auth']) {
    assert.equal(parseContentHost(`${label}.${domain}`, domain), undefined, `deny reserved ${label} label`);
  }
  const id = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(parseContentHost(`${id}.${domain}`, domain), { kind: 'stable', artifactId: id });
  assert.deepEqual(parseContentHost(`${id}.pinned.${domain}`, domain), { kind: 'pinned', releaseId: id });
}
