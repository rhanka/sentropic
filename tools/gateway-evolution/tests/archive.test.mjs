import { it } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { inspectArchive } from '../archive.mjs';
function archive(path = 'package/package.json', type = '0', data = Buffer.from(JSON.stringify({ name: '@sentropic/llm-mesh', version: '0.27.0' }))) {
  const header = Buffer.alloc(512);
  header.write(path); header.write(data.length.toString(8).padStart(11, '0'), 124);
  header.write(type, 156); header.fill(32, 148, 156);
  const checksum = header.reduce((a, b) => a + b, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
  return gzipSync(Buffer.concat([header, data, Buffer.alloc(512 - data.length), Buffer.alloc(1024)]));
}
it('checks package identity from real gzip/tar bytes before install', () => {
  assert.equal(inspectArchive(archive()).name, '@sentropic/llm-mesh');
});
it('refuses PAX extraction overrides and duplicate fields before install', () => {
  const entry = (text) => {
    let length = text.length + 3;
    while (`${length} ${text}\n`.length !== length) length = `${length} ${text}\n`.length;
    return `${length} ${text}\n`;
  };
  const withPax = (...fields) => {
    const metadata = gunzipSync(archive('PaxHeader', 'x', Buffer.from(fields.map(entry).join(''))));
    return gzipSync(Buffer.concat([metadata.subarray(0, metadata.length - 1024), gunzipSync(archive())]));
  };
  assert.equal(inspectArchive(withPax('path=package/package.json')).name, '@sentropic/llm-mesh');
  for (const fields of [['size=1'], ['GNU.sparse.map=0,1'], ['path=package/package.json', 'path=package/package.json']]) {
    assert.throws(() => inspectArchive(withPax(...fields)), { code: 'unsafe-archive' });
  }
});
it('refuses traversal, links, sensitive paths, truncated and non-tar data', () => {
  for (const path of ['../escape', '/absolute', 'package/.env', 'package/credentials/secrets/key']) {
    assert.throws(() => inspectArchive(archive(path)), { code: 'unsafe-archive' });
  }
  assert.throws(() => inspectArchive(archive('package/package.json', '2')), { code: 'unsafe-archive' });
  assert.throws(() => inspectArchive(Buffer.from('not gzip')), { code: 'unsafe-archive' });
});
