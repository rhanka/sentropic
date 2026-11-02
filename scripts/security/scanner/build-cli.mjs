import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireContract as check } from './contract-schema.mjs';
import { buildEnvironment, probeIsolation } from './build-isolation.mjs';
import { buildOnce, runTwoBuilds } from './build-executor.mjs';

// Fixed command surface for the later protected-workflow wiring (A08): an isolated
// isolation probe, one build, or the sequential two-build reproducibility gate.
// Every result stays candidate data; no receipt, pin or admission is written.
export async function CLI(args) {
  const [command, ...rest] = args;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) options[rest[i].replace(/^--/, '')] = rest[i + 1];
  if (command === 'probe') {
    check(isAbsolute(options.root), 'probe root');
    const env = buildEnvironment({ work: options.root });
    return { candidate: true, productionAdmitted: false,
      isolation: await probeIsolation({ env, root: options.root }), envKeys: Object.keys(env) };
  }
  check(command === 'build-once' || command === 'build-twice', 'command');
  const recipeBytes = await readFile(options.recipe);
  const manifest = JSON.parse(await readFile(options.manifest));
  const input = { recipeBytes, manifest, materialsDir: options.materials, workDir: options.work,
    build: { mode: 'go', package: options.package ?? (options.fixture ? '.' : './cmd/trivy'),
      outputName: options.output ?? 'trivy', ...(options.fixture ? { fixtureDir: options.fixture } : {}) } };
  const result = command === 'build-twice' ? await runTwoBuilds(input) : await buildOnce(input);
  const summary = { ...result, outputs: Object.fromEntries(Object.entries(result.outputs)
    .map(([name, o]) => [name, { path: o.path, digest: o.digest, size: o.size }])) };
  if (options.out) {
    await mkdir(options.out, { recursive: true });
    await writeFile(join(options.out, 'build-result.json'), JSON.stringify(summary));
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  CLI(process.argv.slice(2)).then(summary => console.log(JSON.stringify(summary)),
    error => { console.error(error.message); process.exit(1); });
}
