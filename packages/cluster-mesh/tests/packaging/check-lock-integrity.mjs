// Pre-publication lock integrity for the `selected` fixture (release-train design sections 2d and 3).
// Runs inside the packaging container only (packaging.mk); never on the host.
//   refresh <working-lock> <committed-lock> <package.json> <siblings-dir>
//       write the committed lock from a provisional install: sibling-sourced entries get the registry
//       `resolved` URL and the sha512 of the sibling bytes (a sibling absent or at another version in the working
//       lock is an error and nothing is written); the candidate keeps no integrity
//   siblings <committed-lock> <siblings-dir>
//       every sibling run: committed entry version/resolved/integrity must equal the sibling archive
//   registry <committed-lock>
//       after publication: registry dist.tarball and dist.integrity of each published train package must equal the
//       lock `resolved` and `integrity`
import fs from 'node:fs';
import { readIndex } from './siblings.mjs';

const REGISTRY = 'https://registry.npmjs.org';
const TRAIN = ['@sentropic/llm-mesh', '@sentropic/llm-gateway'];
const CANDIDATE = '@sentropic/cluster-mesh';

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const tarballUrl = (name, version) => `${REGISTRY}/${name}/-/${name.split('/').pop()}-${version}.tgz`;
let errors = 0;
const error = (message) => {
  errors += 1;
  console.log(`::error title=Train lock integrity::${message}`);
};

function refresh(workingLock, committedLock, packageJson, siblingsDir) {
  const lock = readJson(workingLock);
  const manifest = readJson(packageJson);
  delete lock.packages[`node_modules/${CANDIDATE}`].integrity;
  lock.packages[''].dependencies = { ...manifest.dependencies };
  for (const sibling of readIndex(siblingsDir)) {
    if (sibling.name === CANDIDATE) continue;
    const entry = lock.packages[`node_modules/${sibling.name}`];
    if (!entry || entry.version !== sibling.version) {
      error(`${sibling.name}@${sibling.version} is a sibling but the working lock pins ${entry?.version ?? 'nothing'}`);
      continue;
    }
    entry.resolved = tarballUrl(sibling.name, sibling.version);
    entry.integrity = sibling.integrity;
  }
  const text = `${JSON.stringify(lock, null, 2)}\n`;
  if (text.includes('"file:/')) error('refreshed lock still references an absolute file: path');
  if (errors === 0) fs.writeFileSync(committedLock, text);
}

function siblings(committedLock, siblingsDir) {
  const lock = readJson(committedLock);
  for (const sibling of readIndex(siblingsDir)) {
    if (sibling.name === CANDIDATE) continue;
    const entry = lock.packages[`node_modules/${sibling.name}`];
    if (!entry) {
      error(`${sibling.name}@${sibling.version} is a sibling but absent from the committed lock`);
      continue;
    }
    if (entry.version !== sibling.version) error(`${sibling.name}: lock pins ${entry.version}, sibling is ${sibling.version}`);
    if (entry.resolved !== tarballUrl(sibling.name, sibling.version)) error(`${sibling.name}: lock resolved ${entry.resolved} is not the registry URL`);
    if (entry.integrity !== sibling.integrity) {
      error(`${sibling.name}@${sibling.version}: lock integrity ${entry.integrity} != sibling ${sibling.integrity}`);
    } else console.log(`[lock] ${sibling.name}@${sibling.version} integrity matches the sibling archive`);
  }
}

async function registry(committedLock) {
  const lock = readJson(committedLock);
  for (const name of TRAIN) {
    const entry = lock.packages[`node_modules/${name}`];
    if (!entry) {
      error(`${name} is absent from the committed lock`);
      continue;
    }
    if (entry.resolved !== tarballUrl(name, entry.version)) error(`${name}: lock resolved ${entry.resolved} is not the registry URL`);
    const response = await fetch(`${REGISTRY}/${name.replace('/', '%2f')}`);
    if (!response.ok) {
      error(`${name}: registry lookup failed (${response.status})`);
      continue;
    }
    const published = (await response.json()).versions?.[entry.version];
    if (!published) {
      console.log(`::notice title=Train lock integrity::${name}@${entry.version} is not published; nothing to compare`);
      continue;
    }
    if (published.dist?.tarball !== entry.resolved) {
      error(`${name}@${entry.version}: registry dist.tarball ${published.dist?.tarball} != committed lock resolved ${entry.resolved}`);
    }
    if (published.dist?.integrity !== entry.integrity) {
      error(`${name}@${entry.version}: registry dist.integrity ${published.dist?.integrity} != committed lock ${entry.integrity}`);
    } else console.log(`[lock] ${name}@${entry.version} registry integrity matches the committed lock`);
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === 'refresh' && args.length === 4) refresh(...args);
else if (command === 'siblings' && args.length === 2) siblings(...args);
else if (command === 'registry' && args.length === 1) await registry(args[0]);
else {
  console.error('usage: check-lock-integrity.mjs refresh <working-lock> <committed-lock> <package.json> <siblings-dir>'
    + ' | siblings <committed-lock> <siblings-dir> | registry <committed-lock>');
  process.exit(2);
}
process.exit(errors === 0 ? 0 : 1);
