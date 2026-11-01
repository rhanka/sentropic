import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The canonical production artifact is pinned through API_IMAGE_REF, which the
// Makefile exports from the recorded receipt. The production digest ships
// without npm, so any dev-stack command that resolves it fails with
// `sh: npm: not found`. The dev overlay must therefore pin the development
// tag explicitly (ignoring API_IMAGE_REF), while base and CI overlays keep
// the pin for SUT lanes (BR81-EX5).
const root = new URL('../../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');

const serviceImageLines = (text, service) => {
  const lines = text.split('\n');
  const header = lines.findIndex((line) => line === `  ${service}:`);
  assert.notEqual(header, -1, `service ${service} exists`);
  const images = [];
  for (let i = header + 1; i < lines.length; i++) {
    if (/^  \S/.test(lines[i])) break;
    if (/^    image:/.test(lines[i])) images.push(lines[i].trim());
  }
  return images;
};

test('dev overlay resolves the api service to the development tag', () => {
  const images = serviceImageLines(read('docker-compose.dev.yml'), 'api');
  assert.equal(images.length, 1, 'dev overlay declares exactly one api image');
  assert.doesNotMatch(images[0], /API_IMAGE_REF/, 'dev api image ignores the production pin');
  assert.match(images[0], /\$\{REGISTRY\}\/\$\{API_IMAGE_NAME:-sentropic-api\}:\$\{API_VERSION:-latest\}/,
    'dev api image replicates the base fallback tag');
});

test('base and CI overlays retain the production pin for SUT lanes', () => {
  const pinned = [
    ['docker-compose.yml', 'api'],
    ['docker-compose.ci.yml', 'api-sut'],
  ];
  for (const [file, service] of pinned) {
    const images = serviceImageLines(read(file), service);
    assert.ok(images.length > 0, `${file} declares a ${service} image`);
    for (const image of images) {
      assert.match(image, /API_IMAGE_REF/, `${file}: ${image} keeps the production pin`);
    }
  }
});
