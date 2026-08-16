import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const values = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === '--dry-run') values.set('dryRun', true);
  else if (arg?.startsWith('--')) values.set(arg.slice(2), process.argv[++index]);
  else throw new Error(`Unexpected argument: ${arg}`);
}

const model = values.get('model');
const base = values.get('base');
const root = resolve(values.get('root') ?? process.cwd());
const dryRun = values.get('dryRun') === true;
const validId = /^[a-z0-9][a-z0-9._@/-]*$/;
if (typeof model !== 'string' || !validId.test(model)) {
  throw new Error('--model must be a lowercase provider model id');
}
if (typeof base !== 'string' || !validId.test(base)) {
  throw new Error('--base must be a lowercase provider model id');
}
if (model === base) throw new Error('--model and --base must differ');

const paths = {
  catalog: resolve(root, 'packages/llm-mesh/src/catalog.ts'),
  providers: resolve(root, 'packages/llm-mesh/src/providers.ts'),
  routing: resolve(root, 'packages/llm-mesh/src/routing-targets.ts'),
};
const original = Object.fromEntries(await Promise.all(
  Object.entries(paths).map(async ([key, path]) => [key, await readFile(path, 'utf8')]),
));

const quoted = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blockContaining = (source, marker, endIndent = 2) => {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`BASE entry not found: ${marker}`);
  const start = source.lastIndexOf(`${' '.repeat(endIndent)}{\n`, markerIndex);
  const endMarker = `\n${' '.repeat(endIndent)}},`;
  const end = source.indexOf(endMarker, markerIndex);
  if (start < 0 || end < 0) throw new Error(`Could not isolate BASE entry: ${marker}`);
  return { start, end: end + endMarker.length, text: source.slice(start, end + endMarker.length) };
};
const insertAfter = (source, block, addition) =>
  `${source.slice(0, block.end)}\n${addition}${source.slice(block.end)}`;
const keyedBlock = (source, marker) => {
  const start = source.indexOf(marker);
  const endMarker = '\n  },';
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`BASE route not found: ${marker}`);
  return { start, end: end + endMarker.length, text: source.slice(start, end + endMarker.length) };
};

let catalog = original.catalog;
const baseProfile = blockContaining(catalog, `    modelId: '${base}',`);
const provider = baseProfile.text.match(/providerId: '([^']+)'/)?.[1];
if (!provider) throw new Error(`Could not resolve provider for BASE ${base}`);
if (!catalog.includes(`    modelId: '${model}',`)) {
  const copied = baseProfile.text
    .replace(`modelId: '${base}'`, `modelId: '${model}'`)
    .replace(/label: '[^']*'/, `label: '[VERIFY] ${model}'`);
  catalog = insertAfter(catalog, baseProfile,
    `  // MODEL UPDATE SCAFFOLD: copied from ${base}; verify every field.\n${copied}`);
}

let providers = original.providers;
const addProviderId = (source, startMarker, endMarker, indentation) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Could not isolate provider list: ${startMarker}`);
  const segment = source.slice(start, end);
  if (segment.includes(`'${model}'`)) return source;
  const pattern = new RegExp(`^${indentation}'${quoted(base)}',\\s*$`, 'm');
  if (!pattern.test(segment)) throw new Error(`BASE ${base} not found in ${startMarker}`);
  const updated = segment.replace(pattern, (line) => `${line}\n${indentation}'${model}',`);
  return `${source.slice(0, start)}${updated}${source.slice(end)}`;
};
providers = addProviderId(providers, 'export const knownModelIds = [', '] as const', '  ');
providers = addProviderId(providers, `  ${provider}: [`, '],', '    ');

let routing = original.routing;
const routingSectionEnd = routing.indexOf('\n};', routing.indexOf('DEFAULT_TARGET_MAPPINGS'));
const routingSection = routing.slice(0, routingSectionEnd);
if (!routingSection.includes(`  '${model}': {`)) {
  const baseRoute = keyedBlock(routingSection, `  '${base}': {`);
  const copied = baseRoute.text.split(base).join(model);
  routing = insertAfter(routing, baseRoute,
    `  // MODEL UPDATE SCAFFOLD: copied from ${base}; verify transport.\n${copied}`);
}

const next = { catalog, providers, routing };
const changed = Object.keys(paths).filter((key) => next[key] !== original[key]);
if (!dryRun) await Promise.all(changed.map((key) => writeFile(paths[key], next[key])));

console.log(`${dryRun ? 'Dry run' : 'Applied'}: ${changed.length ? changed.join(', ') : 'no changes'}`);
console.log('Manual gates: verify official model id and every copied capability; remove scaffold comments.');
console.log('Review STANDARD_ROUTE_DEFINITIONS and CLOUD_CODE_CAPABILITY_SOURCE_BY_MODEL explicitly.');
console.log('Update or exclude the council, refresh/check generation, tests, consumers, semver, and lockfiles.');
console.log('Publish llm-mesh before llm-gateway, then notify h-cond/h2a-runtime host-default owners.');
