import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, link, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { digest } from '../daily/toolchain-contract.mjs';
import { requireContract as check } from './contract-schema.mjs';
import { validateMaterialInventory } from './material-contract.mjs';
import { verifyRetainedMaterials } from './retained-materials.mjs';
import { applyOrderedPatches } from './material-patches.mjs';
import { offlineGoEnvironment, proxyPathFromRetained, verifyResolvedModules } from './offline-dependencies.mjs';

const execFileAsync = promisify(execFile);
const GO_JOSE = 'github.com/go-jose/go-jose/v4';

export async function extractTar(archive, destination, stripComponents = 0) {
  await mkdir(destination, { recursive: true });
  const args = ['-xzf', archive, '-C', destination];
  if (stripComponents > 0) args.push(`--strip-components=${stripComponents}`);
  await execFileAsync('tar', args, { maxBuffer: 64 * 1024 * 1024 });
}

// Hardlink tree with copy fallback; patched files are replaced (never written through
// a shared inode) so the pristine extraction stays intact for the second run.
export async function linkTree(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await linkTree(from, to);
    else {
      await rm(to, { force: true });
      try { await link(from, to); } catch { await copyFile(from, to); }
    }
  }
}

function parseModuleStream(stdout) {
  const trimmed = stdout.trim();
  check(trimmed.length > 0, 'empty go mod download output');
  return JSON.parse(`[${trimmed.replace(/}\s*{/g, '},{')}]`);
}

// Replays the retained materials with the pinned compiler and a file-only proxy.
// The gate runs under --network=none; no credential, VCS or toolchain fetch is possible.
export async function replayDependencies({ recipeBytes, manifest, destination, workingDirectory } = {}) {
  const recipe = validateMaterialInventory({ recipeBytes, manifest });
  await verifyRetainedMaterials({ recipeBytes, manifest, destination });
  check(typeof workingDirectory === 'string' && workingDirectory.length > 0, 'working directory');
  const work = workingDirectory;
  const proxyDir = join(work, 'proxy');
  const compilerDir = join(work, 'compiler');
  const sourceDir = join(work, 'source');

  for (const material of manifest.materials) {
    if (material.kind !== 'go-module') continue;
    check(material.path.startsWith('proxy/'), 'go-module material prefix');
    const raw = proxyPathFromRetained(material.path.slice('proxy/'.length));
    const target = join(proxyDir, raw);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(destination, material.path), target);
  }
  await extractTar(join(destination, recipe.go.compiler), compilerDir);
  await extractTar(join(destination, recipe.upstream.archive), sourceDir, 1);
  const goRoot = join(compilerDir, 'go');
  const goBin = join(goRoot, 'bin', 'go');

  const envelopes = [];
  for (const patch of recipe.patches) {
    const bytes = await readFile(join(destination, patch.path));
    envelopes.push({ bytes, digest: digest(bytes) });
  }
  const targets = new Set();
  for (const envelope of envelopes) {
    for (const file of JSON.parse(envelope.bytes.toString('utf8')).files) targets.add(file.path);
  }
  const source = {};
  for (const name of targets) source[name] = await readFile(join(sourceDir, name));

  async function resolveRun(name, patches) {
    const runDir = join(work, name);
    await linkTree(sourceDir, runDir);
    const patched = applyOrderedPatches(source, patches);
    for (const [file, bytes] of Object.entries(patched)) {
      const target = join(runDir, file);
      await rm(target, { force: true });
      await writeFile(target, bytes);
    }
    await mkdir(join(runDir, 'tmp'), { recursive: true });
    const env = { ...offlineGoEnvironment(runDir, proxyDir, goRoot), TMPDIR: join(runDir, 'tmp') };
    check(env.GOPROXY.startsWith('file://') && env.GOSUMDB === 'off' && env.GOVCS === '*:off' &&
      env.GOTOOLCHAIN === 'local', 'offline-only Go environment');
    // No-args download resolves exactly the modules needed to build the main module's
    // packages; every one of them is bound to a reviewed go.sum entry by the check below.
    const { stdout } = await execFileAsync(goBin, ['mod', 'download', '-json'],
      { cwd: runDir, env, maxBuffer: 64 * 1024 * 1024, timeout: 900000 });
    const modules = parseModuleStream(stdout);
    return { patched, modules };
  }

  const full = await resolveRun('run-full', envelopes);
  verifyResolvedModules({ goMod: full.patched['go.mod'].toString('utf8'),
    goSum: full.patched['go.sum'].toString('utf8'), modules: full.modules });
  const patchedGoJose = full.modules.find(m => m.Path === GO_JOSE)?.Version;

  // OS-only repair: every patch that does not touch the embedded Go module leaves
  // go-jose at the vulnerable pin, which the resolved-graph check must refuse.
  const osOnlyPatches = envelopes.filter(envelope =>
    !JSON.parse(envelope.bytes.toString('utf8')).files.some(f => f.path === 'go.mod' || f.path === 'go.sum'));
  check(osOnlyPatches.length > 0 && osOnlyPatches.length < envelopes.length, 'OS-only patch subset');
  const osOnly = await resolveRun('run-os-only', osOnlyPatches);
  const osOnlyGoJose = osOnly.modules.find(m => m.Path === GO_JOSE)?.Version;
  let osOnlyRejected = false;
  try {
    verifyResolvedModules({ goMod: osOnly.patched['go.mod'].toString('utf8'),
      goSum: osOnly.patched['go.sum'].toString('utf8'), modules: osOnly.modules });
  } catch (error) {
    check(/scanner-contract/.test(error.message), 'OS-only rejection cause');
    osOnlyRejected = true;
  }
  check(osOnlyRejected && patchedGoJose === 'v4.1.6' && osOnlyGoJose === 'v4.1.5' && full.modules.length > 1,
    'replay outcome');
  return { productionAdmitted: false, network: 'none', patchedGoJose, osOnlyGoJose, osOnlyRejected,
    modules: full.modules.length };
}
