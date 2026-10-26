// Update only release-tuple metadata from real, guarded archives; preserve other frozen dependencies.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dir = '/source/packages/cluster-mesh/tests/packaging/fixtures/selected';
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const manifest = read(`${dir}/package.json`);
const lock = read(`${dir}/package-lock.json`);
const siblings = process.argv[2];
const receipts = read(`${siblings}/receipts.json`);
for (const slug of ['cluster-mesh', 'llm-mesh', 'llm-gateway']) {
  const candidate = read(`/source/packages/${slug}/package.json`);
  const entry = lock.packages[`node_modules/${candidate.name}`];
  const local = slug === 'cluster-mesh';
  manifest.dependencies[candidate.name] = local ? `file:../sentropic-${slug}-${candidate.version}.tgz` : candidate.version;
  entry.version = candidate.version;
  entry.resolved = local ? manifest.dependencies[candidate.name]
    : `https://registry.npmjs.org/${candidate.name}/-/${slug}-${candidate.version}.tgz`;
  if (local) delete entry.integrity;
  else {
    const receipt = receipts.find((item) => item.name === candidate.name && item.version === candidate.version);
    if (!receipt || receipt.guard !== 'pass') throw new Error(`Missing guarded archive for ${candidate.name}`);
    const bytes = fs.readFileSync(path.join(siblings, receipt.file));
    if (createHash('sha256').update(bytes).digest('hex') !== receipt.sha256) throw new Error('Archive digest mismatch');
    entry.integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  }
  for (const field of ['dependencies', 'peerDependencies', 'peerDependenciesMeta']) {
    if (candidate[field]) entry[field] = Object.fromEntries(
      [...new Set([...Object.keys(entry[field] ?? {}), ...Object.keys(candidate[field])])]
        .filter((key) => key in candidate[field]).map((key) => [key, candidate[field][key]]));
    else delete entry[field];
  }
}
lock.packages[''].dependencies = { ...manifest.dependencies };
for (const [file, value] of [['package.json', manifest], ['package-lock.json', lock]]) {
  fs.writeFileSync(`${dir}/${file}`, `${JSON.stringify(value, null, 2)}\n`);
}
