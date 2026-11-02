import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, copyFile, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { digest } from '../daily/toolchain-contract.mjs';
import { requireContract as check, text } from './contract-schema.mjs';
import { validateMaterialInventory } from './material-contract.mjs';
import { verifyRetainedMaterials } from './retained-materials.mjs';
import { applyOrderedPatches } from './material-patches.mjs';
import { extractTar, linkTree } from './native-replay.mjs';
import { proxyPathFromRetained } from './offline-dependencies.mjs';
import { buildEnvironment, probeIsolation } from './build-isolation.mjs';
import { compareBuilds, dependenciesInventory, makeOciLayout, normalizeOutputTree,
  parseApkPackage, parseGoModuleList } from './build-layout.mjs';

const execFileAsync = promisify(execFile);
const BUILD_FLAGS = ['-trimpath', '-buildvcs=false'];
const TAR_COMMAND = 'tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf layer.tar -C rootfs .';

async function freshDir(dir) {
  check(typeof dir === 'string' && isAbsolute(dir) && dir.split('/').length > 2, 'work directory');
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  check(await realpath(dir) === resolve(dir), 'work directory symlink');
  return dir;
}

async function stageRetainedProxy(manifest, materialsDir, proxyDir) {
  for (const material of manifest.materials) {
    if (material.kind !== 'go-module') continue;
    const raw = proxyPathFromRetained(material.path.slice('proxy/'.length));
    const target = join(proxyDir, raw);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(materialsDir, material.path), target);
  }
}

// acquire-upstream + apply-patches: verify the retained bytes, extract the pinned
// source and apply only the reviewed digest-bound patches into a fresh tree.
export async function stagePatchedSource({ recipeBytes, manifest, materialsDir, runDir } = {}) {
  const recipe = validateMaterialInventory({ recipeBytes, manifest });
  await verifyRetainedMaterials({ recipeBytes, manifest, destination: materialsDir });
  const work = await freshDir(runDir);
  const sourceDir = join(work, 'source');
  await extractTar(join(materialsDir, recipe.upstream.archive), sourceDir, 1);
  const envelopes = [];
  for (const patch of recipe.patches) {
    const bytes = await readFile(join(materialsDir, patch.path));
    envelopes.push({ bytes, digest: digest(bytes) });
  }
  const targets = new Set();
  for (const envelope of envelopes) {
    for (const file of JSON.parse(envelope.bytes.toString('utf8')).files) targets.add(file.path);
  }
  const source = {};
  for (const name of targets) source[name] = await readFile(join(sourceDir, name));
  const patched = applyOrderedPatches(source, envelopes);
  const tree = join(work, 'tree');
  await linkTree(sourceDir, tree);
  for (const [file, bytes] of Object.entries(patched)) {
    const target = join(tree, file);
    await rm(target, { force: true });
    await writeFile(target, bytes);
  }
  return { sourceCommit: recipe.sourceCommit, files: patched, tree };
}

// One isolated build: verified retained materials, pinned offline Go toolchain,
// isolation probe, deterministic rebuild, OCI layout and normalized SBOM.
export async function buildOnce({ recipeBytes, manifest, materialsDir, workDir, build } = {}) {
  const recipe = validateMaterialInventory({ recipeBytes, manifest });
  check(build && build.mode === 'go' && text(build.package) && text(build.outputName), 'build spec');
  await verifyRetainedMaterials({ recipeBytes, manifest, destination: materialsDir });
  const work = await freshDir(workDir);
  const proxyDir = join(work, 'proxy');
  await stageRetainedProxy(manifest, materialsDir, proxyDir);
  await extractTar(join(materialsDir, recipe.go.compiler), join(work, 'compiler'));
  const goRoot = join(work, 'compiler', 'go');
  const goBin = join(goRoot, 'bin', 'go');
  let moduleDir;
  if (build.fixtureDir) {
    check(isAbsolute(build.fixtureDir), 'fixture directory');
    moduleDir = join(work, 'module');
    await mkdir(moduleDir, { recursive: true });
    for (const entry of await readdir(build.fixtureDir, { withFileTypes: true })) {
      check(entry.isFile(), 'fixture entry');
      await copyFile(join(build.fixtureDir, entry.name), join(moduleDir, entry.name));
    }
  } else {
    moduleDir = (await stagePatchedSource({ recipeBytes, manifest, materialsDir,
      runDir: join(work, 'staged') })).tree;
  }
  await mkdir(join(work, 'tmp'), { recursive: true });
  const env = buildEnvironment({ work, proxyDir, goRoot, toolDirs: [join(goRoot, 'bin')] });
  const isolation = await probeIsolation({ env, root: work });
  const outDir = join(work, 'out');
  await mkdir(outDir, { recursive: true });
  const binaryPath = join(outDir, build.outputName);
  const buildCommand = `${goBin} build ${BUILD_FLAGS.join(' ')} -o ${build.outputName} ${build.package}`;
  await execFileAsync(goBin, ['build', ...BUILD_FLAGS, '-o', binaryPath, build.package],
    { cwd: moduleDir, env, maxBuffer: 64 * 1024 * 1024, timeout: 900000 });
  const { stdout } = await execFileAsync(goBin, ['list', '-m', 'all'],
    { cwd: moduleDir, env, maxBuffer: 16 * 1024 * 1024 });
  const deps = dependenciesInventory({ modules: parseGoModuleList(stdout),
    osPackages: recipe.base.packages.map(parseApkPackage) });
  const rootfs = join(work, 'rootfs');
  await mkdir(join(rootfs, 'usr', 'bin'), { recursive: true });
  await copyFile(binaryPath, join(rootfs, 'usr', 'bin', build.outputName));
  await chmod(join(rootfs, 'usr', 'bin', build.outputName), 0o755);
  const layout = await makeOciLayout({ rootfs, outDir, labels: {
    'org.opencontainers.image.source': recipe.upstream.repository,
    'org.opencontainers.image.revision': recipe.sourceCommit,
    'org.opencontainers.image.version': recipe.upstream.version } });
  const binaryBytes = await readFile(binaryPath);
  const binary = { path: build.outputName, digest: digest(binaryBytes), size: binaryBytes.length };
  const sbom = { schemaVersion: 1, candidate: true, productionAdmitted: false, binary,
    source: { repository: recipe.upstream.repository, version: recipe.upstream.version, commit: recipe.sourceCommit },
    patchRevision: recipe.patchRevision, components: deps.components };
  await writeFile(join(outDir, 'sbom.json'), JSON.stringify(sbom));
  const outputs = { [build.outputName]: { ...binary, bytes: binaryBytes } };
  for (const [name, bytes] of Object.entries(layout.files)) {
    outputs[name] = { path: name, digest: digest(bytes), size: bytes.length, bytes };
  }
  const sbomBytes = await readFile(join(outDir, 'sbom.json'));
  outputs['sbom.json'] = { path: 'sbom.json', digest: digest(sbomBytes), size: sbomBytes.length, bytes: sbomBytes };
  const normalized = { filesystemDigest: (await normalizeOutputTree(rootfs)).filesystemDigest,
    binaryDigest: binary.digest, dependenciesDigest: deps.dependenciesDigest };
  return { candidate: true, productionAdmitted: false, network: 'none', isolation, normalized, outputs,
    commands: [buildCommand, `${goBin} list -m all`, TAR_COMMAND], sourceCommit: recipe.sourceCommit };
}

// The two isolated reproductions run sequentially in separate fresh work
// directories; any normalized difference refuses the candidate.
export async function runTwoBuilds(input = {}) {
  const first = await buildOnce({ ...input, workDir: join(input.workDir, 'first') });
  const second = await buildOnce({ ...input, workDir: join(input.workDir, 'second') });
  return { candidate: true, productionAdmitted: false, network: 'none', isolation: first.isolation,
    reproducibility: { first: first.normalized, second: second.normalized, ...compareBuilds(first, second) },
    outputs: first.outputs, commands: [...first.commands, ...second.commands] };
}
