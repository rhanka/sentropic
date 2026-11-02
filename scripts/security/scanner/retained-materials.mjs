import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { lstat, realpath, readdir, mkdir, mkdtemp, open, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { validateMaterialInventory } from './material-contract.mjs';
import { requireContract as check, equal, CONTRACT_ONLY } from './contract-schema.mjs';

function declaration(input) {
  const recipe = validateMaterialInventory(input);
  const materials = input.manifest.materials;
  check(materials.length <= 12000 && materials.every(m => m.size <= 1024 ** 3) &&
    materials.reduce((sum, m) => sum + m.size, 0) <= 8 * 1024 ** 3, 'acquisition byte/count budget');
  return recipe;
}
async function measuredStream(stream, material, file) {
  let size = 0;
  const hash = createHash('sha256');
  for await (const chunk of stream) {
    size += chunk.length;
    check(size <= material.size, `material size: ${material.path}`);
    hash.update(chunk);
    if (file) await file.writeFile(chunk);
  }
  check(size === material.size && `sha256:${hash.digest('hex')}` === material.digest,
    `material checksum: ${material.path}`);
}
async function inventory(directory, expected, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    check(!entry.isSymbolicLink(), 'retained symlink');
    if (entry.isDirectory()) {
      check(expected.some(p => p.startsWith(`${name}/`)), 'undeclared directory');
      files.push(...await inventory(join(directory, entry.name), expected, `${name}/`));
    } else {
      check(entry.isFile() && expected.includes(name), 'undeclared retained file');
      files.push(name);
    }
  }
  return files;
}
export async function verifyRetainedMaterials(input) {
  declaration(input);
  try {
    check(await realpath(input.destination) === resolve(input.destination), 'retained root symlink');
    const expected = input.manifest.materials.map(m => m.path).sort();
    check(equal((await inventory(input.destination, expected)).sort(), expected), 'retained inventory');
    for (const material of input.manifest.materials) {
      const filename = join(input.destination, material.path);
      check((await lstat(filename)).size === material.size, 'retained size');
      await measuredStream(createReadStream(filename, { flags: constants.O_RDONLY | constants.O_NOFOLLOW }), material);
    }
  } catch (error) { throw new Error('scanner-contract: retained material verification', { cause: error }); }
  return CONTRACT_ONLY;
}
async function responseFor(material, recipe, fetcher) {
  let url = material.url;
  const signal = AbortSignal.timeout(120000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const parsed = new URL(url);
    check(parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.hash &&
      recipe.origins.includes(parsed.origin), 'acquisition origin');
    const response = await fetcher(url, { redirect: 'manual', credentials: 'omit', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      check(response.headers.has('location'), 'redirect location');
      url = new URL(response.headers.get('location'), url).href;
      continue;
    }
    check(response.status === 200 && response.body, 'material HTTP response');
    const size = response.headers.get('content-length');
    check(size === null || size === String(material.size), 'HTTP material size');
    return response;
  }
  check(false, 'redirect budget');
}
export async function retainMaterials(input) {
  const recipe = declaration(input);
  const destination = resolve(input.destination);
  let staging;
  try {
    check(await realpath(dirname(destination)) === dirname(destination), 'acquisition parent symlink');
    const existing = await lstat(destination).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    check(!existing, 'fresh retained destination required');
    staging = await mkdtemp(`${destination}.partial-`);
    for (const material of input.manifest.materials) {
      const response = await responseFor(material, recipe, input.fetcher ?? fetch);
      const filename = join(staging, material.path);
      await mkdir(dirname(filename), { recursive: true });
      const file = await open(filename, 'wx', 0o600);
      try { await measuredStream(response.body, material, file); } finally { await file.close(); }
    }
    await verifyRetainedMaterials({ ...input, destination: staging });
    await rename(staging, destination);
    staging = undefined;
  } catch (error) { throw new Error('scanner-contract: retained acquisition', { cause: error }); }
  finally { if (staging) await rm(staging, { recursive: true, force: true }); }
  return CONTRACT_ONLY;
}
