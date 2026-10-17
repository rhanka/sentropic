import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../.h2a/comments-deps/package.json', import.meta.url));
const { build } = require('esbuild');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const freeze = JSON.parse(await readFile('docs/comments-annotations/contract/contract-v1.json', 'utf8'));
const source = 'packages/comments/tests/conformance/comments-conformance.ts';
const vectors = 'packages/comments/tests/fixtures/revision-hash-v1.json';
const expectedSource = '26cdaf181afbc73c145c57974c6762230757bc101a0418f8da0654f505fb7b00';
const expectedVectors = '26ee62b09d22f39438c344a9223564f08e696eeba95ddd0558f357407a40f0c0';
for (const artifact of freeze.artifacts.filter((entry) => entry.path.startsWith('packages/comments/src/'))) {
  if (sha(await readFile(artifact.path)) !== artifact.sha256) throw new Error(`frozen source drift: ${artifact.path}`);
}
if (sha(await readFile(source)) !== expectedSource || sha(await readFile(vectors)) !== expectedVectors) throw new Error('frozen oracle or vector drift');
const result = await build({ entryPoints: [source], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22', minify: true, metafile: true,
  plugins: [{ name: 'installed-frozen-peer', setup(builder) {
    builder.onResolve({ filter: /^\.\.\/\.\.\/src\// }, () => ({ path: '@sentropic/comments', external: true }));
  } }] });
if (Object.keys(result.metafile.inputs).length !== 1) throw new Error('oracle must contain only the unchanged shared corpus');
const directory = 'packages/cluster-mesh/assets/storage/comments/oracle';
await mkdir(directory, { recursive: true });
const executable = result.outputFiles[0].text;
const vectorArtifact = `${JSON.stringify(JSON.parse(await readFile(vectors, 'utf8')))}\n`;
await writeFile(`${directory}/conformance.mjs`, executable);
await writeFile(`${directory}/revision-hash-v1.json`, vectorArtifact);
await writeFile(`${directory}/manifest.json`, `${JSON.stringify({ version: 1, peer: '@sentropic/comments@0.3.0',
  source: { path: source, sha256: expectedSource }, vectors: { path: vectors, sha256: expectedVectors },
  artifacts: [{ file: 'conformance.mjs', sha256: sha(executable) }, { file: 'revision-hash-v1.json', sha256: sha(vectorArtifact) }],
  compiler: 'esbuild@0.25.5', external: '@sentropic/comments' }, null, 2)}\n`);
