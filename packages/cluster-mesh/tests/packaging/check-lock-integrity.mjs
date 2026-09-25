// Pre-publication lock integrity for the `selected` fixture (release-train design sections 2d and 3).
// Runs inside the packaging container only (packaging.mk); never on the host.
//   refresh <working-lock> <committed-lock> <package.json> <siblings-dir>
//       write the committed lock from a provisional install: sibling-sourced entries get the registry
//       `resolved` URL and the sha512 of the sibling bytes (a sibling absent or at another version in the working
//       lock is an error and nothing is written); the candidate keeps no integrity
//   siblings <committed-lock> <siblings-dir>
//       every sibling run: committed entry version/resolved/integrity must equal the sibling archive
//   registry <committed-lock> [required...]
//       after publication: registry dist.tarball and dist.integrity of each published train package must equal the
//       lock `resolved` and `integrity`; a required package (its publish job succeeded in this run) must be on the
//       registry: cache-bypassing lookups retried 12 x 5 s, then an error; any other absent package is a notice
import fs from 'node:fs';
import { readIndex } from './siblings.mjs';

const REGISTRY = 'https://registry.npmjs.org';
const TRAIN = ['@sentropic/llm-mesh', '@sentropic/llm-gateway'];
const CANDIDATE = '@sentropic/cluster-mesh';
// Lookup base and retry budget; overridable for the unit tests only (lock `resolved` always names REGISTRY).
const LOOKUP_REGISTRY = process.env.CLUSTER_MESH_REGISTRY_LOOKUP_URL ?? REGISTRY;
const RETRIES = Number(process.env.CLUSTER_MESH_REGISTRY_RETRIES ?? 12);
const DELAY_MS = Number(process.env.CLUSTER_MESH_REGISTRY_DELAY_MS ?? 5000);

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

// Registry packument lookup bypassing HTTP caches (a publish of this run may not be visible yet on a cached read).
async function lookup(name, attempt) {
  const url = `${LOOKUP_REGISTRY}/${name.replace('/', '%2f')}?cache-bust=${Date.now()}-${attempt}`;
  try {
    const response = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache', Accept: 'application/json' } });
    return response.ok ? { status: response.status, packument: await response.json() } : { status: response.status };
  } catch (cause) {
    return { status: `network error ${cause.message}` };
  }
}

// A required package was published by a successful publish job of this run: its version must appear, so an
// absent version is retried (RETRIES x DELAY_MS) then fails; any other package keeps one notice-only lookup.
async function registry(committedLock, required) {
  const lock = readJson(committedLock);
  for (const name of TRAIN) {
    const entry = lock.packages[`node_modules/${name}`];
    if (!entry) {
      error(`${name} is absent from the committed lock`);
      continue;
    }
    if (entry.resolved !== tarballUrl(name, entry.version)) error(`${name}: lock resolved ${entry.resolved} is not the registry URL`);
    const attempts = required.includes(name) ? RETRIES : 1;
    let result;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      result = await lookup(name, attempt);
      if (result.packument?.versions?.[entry.version]) break;
    }
    const published = result.packument?.versions?.[entry.version];
    if (!published && required.includes(name)) {
      error(`${name}@${entry.version} was published in this run but is absent from the registry after ${attempts} attempts (last status ${result.status})`);
      continue;
    }
    if (!result.packument) {
      error(`${name}: registry lookup failed (${result.status})`);
      continue;
    }
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
else if (command === 'registry' && args.length >= 1 && args.slice(1).every((name) => TRAIN.includes(name))) {
  await registry(args[0], args.slice(1));
} else {
  console.error('usage: check-lock-integrity.mjs refresh <working-lock> <committed-lock> <package.json> <siblings-dir>'
    + ` | siblings <committed-lock> <siblings-dir> | registry <committed-lock> [required: ${TRAIN.join(' ')}]`);
  process.exit(2);
}
process.exit(errors === 0 ? 0 : 1);
