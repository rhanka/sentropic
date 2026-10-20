// build-inputs.mjs — authoritative P1 build-input record derived from the build definition.
//
// The record is parsed from the Makefile producing targets, the compiler configuration
// files and the pinned Node image — never from a second manual declaration. Changing any
// real build input (compiler pin, unpinned spec, tsconfig, api-extractor config, image)
// changes the fingerprint, so P1 must be regenerated. Unknown install flags and unpinned
// specs fail closed: the parser must be updated, not bypassed.
import { createHash } from 'node:crypto';

export const P1_PRODUCING_TARGETS = ['build-mcp-platform', 'build-mcp-broker', 'api-extract-mcp-platform'];

export const P1_CONFIG_FILES = [
  'packages/mcp-platform/tsconfig.json',
  'packages/mcp-broker/tsconfig.json',
  'packages/mcp-platform/api-extractor.json',
  'packages/mcp-platform/api-extractor.memory.json',
];

const IMAGE_PATTERN = /^MEMORY_L5_NODE_IMAGE\s*:=\s*(\S+)\s*$/m;
const FLAGS_WITH_VALUE = new Set(['--prefix']);
const KNOWN_FLAGS = new Set(['--no-save', '--no-audit', '--no-fund']);

export function specName(spec) {
  const at = String(spec).lastIndexOf('@');
  return at > 0 ? String(spec).slice(0, at) : String(spec);
}

function parseInstallSpecs(recipeLines, target) {
  const specs = [];
  let found = false;
  for (const raw of recipeLines) {
    const idx = raw.indexOf('npm install');
    if (idx < 0) continue;
    found = true;
    const tokens = raw.slice(idx + 'npm install'.length).split('>')[0].trim().split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === '') continue;
      if (FLAGS_WITH_VALUE.has(token)) {
        i++;
        continue;
      }
      if (KNOWN_FLAGS.has(token)) continue;
      if (token.startsWith('-')) {
        throw new Error(`build inputs: unknown install flag ${token} in ${target}; update the parser`);
      }
      specs.push(token);
    }
  }
  if (!found) throw new Error(`build inputs: no npm install in ${target}`);
  return [...new Set(specs)].sort();
}

export function parseToolchainSpecs(makefileText) {
  const text = String(makefileText);
  const image = text.match(IMAGE_PATTERN);
  if (!image) throw new Error('build inputs: MEMORY_L5_NODE_IMAGE pin not found');
  const blocks = {};
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('\t')) {
      if (current) (blocks[current] ??= []).push(line);
      continue;
    }
    const header = line.match(/^([A-Za-z0-9_.-]+)\s*:/);
    current = header && P1_PRODUCING_TARGETS.includes(header[1]) ? header[1] : null;
  }
  const targets = {};
  for (const target of P1_PRODUCING_TARGETS) {
    const specs = parseInstallSpecs(blocks[target] || [], target);
    for (const spec of specs) {
      const version = spec.slice(specName(spec).length + 1);
      if (specName(spec) === spec || !/^\d+\.\d+\.\d+/.test(version)) {
        throw new Error(`build inputs: unpinned toolchain spec ${spec} in ${target}; pin it`);
      }
    }
    targets[target] = specs;
  }
  return { image: image[1], targets };
}

export function hashConfigFiles(files) {
  const digests = {};
  for (const path of Object.keys(files || {}).sort()) {
    const bytes = files[path];
    digests[path] = createHash('sha256').update(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes).digest('hex');
  }
  return digests;
}
