// Static call-site contract: tool argument sets select complete committed profiles;
// consumers share the frozen closure and may add only explicit candidate archives.
import fs from 'node:fs';
import path from 'node:path';
import { scannedSources } from './ci-lockfile-installs.mjs';
import { addLock } from './frozen-registry.mjs';

const historical = ['@sentropic/auth-hono@0.15.0', '@sentropic/llm-mesh@0.19.2',
  '@sentropic/llm-mesh@0.21.2', '@sentropic/llm-gateway@0.18.0', '@sentropic/cluster-mesh@0.23.2'];
const specPattern = /(?:^|[\s'",])((?:@[a-z0-9_-]+\/)?[a-z0-9_.-]+@(?:\^|~)?\d+\.\d+\.\d+(?:[-+][\w.-]+)?)(?=$|[\s'",;>\]])/g;

export function checkBindings(root, tools, consumers) {
  const errors = [];
  const versions = new Map();
  const rootLock = path.join(root, 'package-lock.json');
  if (fs.existsSync(rootLock)) addLock(versions, JSON.parse(fs.readFileSync(rootLock)));
  for (const profile of [...Object.values(tools), ...Object.values(consumers)]) addLock(versions, profile.lock);
  for (const spec of historical) if (!consumers[spec]) errors.push(`Missing historical consumer closure: ${spec}`);
  const tool = (file, args) => {
    const shallow = args.includes('--install-strategy=shallow');
    const specs = args.replace(/--prefix\s+(?:"[^"]*"|'[^']*'|\S+)/g, '')
      .replace(/--[\w=-]+/g, '').replace(/\$quiet\b/g, '').replace(/["']/g, '').trim().split(/\s+/).filter(Boolean).sort();
    const key = (shallow ? 'shallow:' : '') + specs.join(' ');
    if (!tools[key]) errors.push(`${file}: No committed tool profile: ${key} (arguments: ${args})`);
  };
  for (const [file, original] of scannedSources(root)) {
    if (file === 'scripts/ci/install-bindings.mjs') continue;
    let source = original.replace(/\\\r?\n\s*/g, ' ');
    if (source.includes('$CM_PEER_TOOLS')) {
      const make = fs.readFileSync(path.join(root, 'Makefile'), 'utf8');
      const peers = /^CLUSTER_MESH_PEER_TOOLS := (.+)$/m.exec(make)?.[1];
      if (!peers) errors.push(`${file}: Missing CLUSTER_MESH_PEER_TOOLS binding`);
      source = source.replaceAll('$CM_PEER_TOOLS', peers ?? 'UNBOUND');
    }
    // Shell/Make/Docker invocations. Imports, COPY statements and hash inputs are not calls.
    for (const match of source.matchAll(/\bnode\s+["']?[^\s"']*locked-(tools|consumer)\.mjs["']?\s+([^;\n>&|]*)/g)) {
      if (match[1] === 'tools') tool(file, match[2]);
      else for (const [, spec] of match[2].matchAll(specPattern)) {
        const at = spec.lastIndexOf('@');
        const name = spec.slice(0, at), version = spec.slice(at + 1);
        if (!versions.get(name)?.has(version)) errors.push(`${file}: No committed consumer version: ${spec}`);
      }
    }
    // JavaScript literal arrays passed to installTools (the final-pack adapter).
    for (const match of source.matchAll(/\binstallTools\(\[([\s\S]*?)\]\)/g)) {
      tool(file, [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]).join(' '));
    }
    for (const match of source.matchAll(/(?:execFileSync|execFile|spawnSync|spawn|run)\(\s*process\.execPath\s*,\s*\[\s*['"][^'"\n]*locked-tools\.mjs['"]\s*,([\s\S]*?)\]/g)) {
      if (match[1].includes('...NATIVE_MODULES.map')) continue;
      tool(file, [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]).join(' '));
    }
    // Windows specs are generated from this data array rather than shell literals.
    if (source.includes("...NATIVE_MODULES.map(m => `${m.name}@${m.version}`)")) {
      const declaration = /const NATIVE_MODULES = \[([\s\S]*?)\];/.exec(source);
      const specs = [...(declaration?.[1] ?? '').matchAll(/name: '([^']+)', version: '([^']+)'/g)].map(m => `${m[1]}@${m[2]}`);
      tool(file, specs.join(' '));
    }
    // Consumer JS adapters forward arrays/manifests into the same committed universe.
    // Check literal registry specs throughout each adapter, including generated manifests.
    if (/['"][^'"\n]*locked-consumer\.mjs['"]/.test(source) && /\.(?:mjs|ts)$/.test(file)) {
      for (const [, spec] of source.matchAll(specPattern)) {
        const at = spec.lastIndexOf('@');
        const name = spec.slice(0, at), version = spec.slice(at + 1);
        if (!versions.get(name)?.has(version)) errors.push(`${file}: No committed consumer version: ${spec}`);
      }
    }
  }
  return errors;
}
