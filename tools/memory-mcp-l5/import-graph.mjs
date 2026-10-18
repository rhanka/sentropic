#!/usr/bin/env node
// import-graph.mjs — L5 Lot 1 static source/packed import-graph lint.
//
// Resolves the JS/declaration graph from the qualified Lot 1 roots,
// covering type/runtime/barrel/dynamic/require edges, and enforces the
// frozen export inventory in exports-v1.json. Fails on any listed module,
// mock/testing/experimental symbol, createInMemoryContext, sibling-source
// alias, unresolved edge, computed dynamic import, root reference-store
// loading, or export inventory drift. Exit 0 with a JSON report on success.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FORBIDDEN_IMPORT_PARTS } from './receipt.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPORTS_INVENTORY = JSON.parse(readFileSync(join(HERE, 'exports-v1.json'), 'utf8'));

const SOURCE_ROOTS = [
  'packages/mcp-platform/src/memory/index.ts',
  'packages/mcp-broker/src/index.ts',
  'packages/mcp-broker/src/memory/index.ts',
  'packages/mcp-platform/src/transport/bridge.ts',
  'packages/mcp-platform/src/transport/dispatch.ts',
  'packages/mcp-platform/src/transport/result-codec.ts',
];

const EXTRA_FORBIDDEN_SPECIFIER_PARTS = [
  '/src/mock/', '/src/experimental/', '/src/testing', 'mock/oidc',
  'createInMemoryContext', 'InMemoryContextOptions', 'better-sqlite3',
];

const DIST_ENTRIES = {
  '@sentropic/mcp-broker': {
    dist: 'packages/mcp-broker/dist/index.js',
    dts: 'packages/mcp-broker/dist/index.d.ts',
    inventory: EXPORTS_INVENTORY.broker,
  },
  '@sentropic/mcp-broker/memory': {
    dist: 'packages/mcp-broker/dist/memory/index.js',
    dts: 'packages/mcp-broker/dist/memory/index.d.ts',
    inventory: EXPORTS_INVENTORY.brokerMemory,
  },
  '@sentropic/mcp-platform/memory': {
    dist: 'packages/mcp-platform/dist/memory/index.js',
    dts: 'packages/mcp-platform/dist/memory/index.d.ts',
    inventory: EXPORTS_INVENTORY.platformMemory,
  },
};

function arg(flag) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

function isForbiddenSpecifier(specifier) {
  if (typeof specifier !== 'string' || specifier.length === 0) return true;
  if (FORBIDDEN_IMPORT_PARTS.some((part) => specifier.includes(part))) return true;
  if (EXTRA_FORBIDDEN_SPECIFIER_PARTS.some((part) => specifier.includes(part))) return true;
  if (/mock|fixture|test-helper|in-memory|fake|stub/i.test(specifier)) return true;
  if (/^@sentropic\/[^/]+\/src(?:\/|$)/.test(specifier)) return true;
  return false;
}

function workspacePackageTarget(rootDir, pkgDirName, sub) {
  try {
    const pkg = JSON.parse(readFileSync(resolve(rootDir, `packages/${pkgDirName}/package.json`), 'utf8'));
    const exp = pkg.exports?.[sub];
    const relTarget = typeof exp === 'string' ? exp : exp?.import;
    if (typeof relTarget !== 'string') return null;
    return { pkgName: pkg.name, rel: join(`packages/${pkgDirName}`, relTarget).replace(/\\/g, '/') };
  } catch {
    return null;
  }
}

function resolveSpecifier(rootDir, fromFile, specifier) {
  if (specifier.startsWith('.')) {
    const base = resolve(rootDir, dirname(fromFile), specifier);
    const exts = ['', '.ts', '.js', '.mjs', '.d.ts', '/index.ts', '/index.js', '/index.mjs', '/index.d.ts'];
    const cands = exts.map((ext) => base + ext);
    if (specifier.endsWith('.js')) {
      const stem = base.slice(0, -3);
      cands.unshift(`${stem}.ts`, `${stem}.d.ts`, `${stem}/index.ts`, `${stem}/index.d.ts`);
    }
    for (const cand of cands) {
      const rel = relative(rootDir, cand);
      if (!rel.startsWith('..') && !rel.startsWith('/') && existsSync(cand)) {
        return { rel: rel.replace(/\\/g, '/'), installed: false };
      }
    }
    return null;
  }
  if (specifier.startsWith('@sentropic/')) {
    const parts = specifier.split('/');
    if (parts.length < 2) return null;
    const pkgName = `${parts[0]}/${parts[1]}`;
    const sub = parts.length > 2 ? `./${parts.slice(2).join('/')}` : '.';
    const found = workspacePackageTarget(rootDir, parts[1], sub);
    if (!found || found.pkgName !== pkgName) return null;
    // Public package contract: an installed (workspace-linked or published)
    // entry, never a sibling source file — even when it physically resolves
    // under packages/.
    if (!existsSync(resolve(rootDir, found.rel))) return null;
    return { rel: found.rel, installed: true };
  }
  if (specifier.startsWith('node:')) return { rel: `external:${specifier}`, installed: true };
  return { rel: `external:${specifier}`, installed: true };
}

function scanSourceGraph(rootDir) {
  const failures = [];
  const edges = [];
  const queue = [...SOURCE_ROOTS];
  const visited = new Set();
  const resolvedFiles = [];
  while (queue.length > 0) {
    const fp = queue.shift();
    if (!fp || visited.has(fp) || fp.startsWith('external:')) continue;
    const abs = resolve(rootDir, fp);
    if (!existsSync(abs)) {
      failures.push(`importGraph: root file missing ${fp}`);
      continue;
    }
    visited.add(fp);
    resolvedFiles.push(fp);
    const code = readFileSync(abs, 'utf8');
    if (/\bimport\s*\(\s*(?!['"][^'"]+['"]\s*\))/.test(code)) {
      failures.push(`importGraph: computed dynamic import in ${fp}`);
    }
    const specs = [
      ...[...code.matchAll(/\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)].map((m) => m[1]),
      ...[...code.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
    ];
    for (const spec of new Set(specs)) {
      if (isForbiddenSpecifier(spec)) {
        failures.push(`importGraph: forbidden import ${spec} in ${fp}`);
        continue;
      }
      const resolved = resolveSpecifier(rootDir, fp, spec);
      if (!resolved) {
        failures.push(`importGraph: unresolved import ${spec} in ${fp}`);
        continue;
      }
      const { rel: to, installed } = resolved;
      if (to.startsWith('external:')) {
        if (to.includes('better-sqlite3')) failures.push(`importGraph: forbidden import ${spec} in ${fp}`);
        edges.push({ from: fp, specifier: spec, to });
        continue;
      }
      if (
        !installed &&
        fp.startsWith('packages/') &&
        to.startsWith('packages/') &&
        fp.split('/')[1] !== to.split('/')[1]
      ) {
        failures.push(`importGraph: sibling source import ${spec} in ${fp}`);
        continue;
      }
      edges.push({ from: fp, specifier: spec, to });
      queue.push(to);
    }
  }
  return { failures, edges, resolvedFiles };
}

function parseDtsExportSets(dtsText) {
  const runtime = new Set();
  const types = new Set();
  for (const match of dtsText.matchAll(/export(\s+type)?\s*\{([^}]*)\}\s*(?:from\s*['"][^'"]+['"])?;?/g)) {
    const blockIsType = match[1] !== undefined;
    for (const part of match[2].split(',')) {
      const name = part.trim();
      if (!name) continue;
      if (blockIsType || name.startsWith('type ')) {
        types.add(name.replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim());
      } else runtime.add(name.split(/\s+as\s+/).pop().trim());
    }
  }
  return { runtime: [...runtime].sort(), types: [...types].sort() };
}

async function checkExportInventory(rootDir, failures) {
  for (const [entry, meta] of Object.entries(DIST_ENTRIES)) {
    const distAbs = resolve(rootDir, meta.dist);
    const dtsAbs = resolve(rootDir, meta.dts);
    if (!existsSync(distAbs) || !existsSync(dtsAbs)) {
      failures.push(`importGraph: built artifact missing for ${entry} (run build first)`);
      continue;
    }
    const mod = await import(pathToFileURL(distAbs).href);
    const actualRuntime = Object.keys(mod).sort();
    const expectedRuntime = [...meta.inventory.runtime].sort();
    if (JSON.stringify(actualRuntime) !== JSON.stringify(expectedRuntime)) {
      failures.push(
        `importGraph: runtime export drift in ${entry}: got [${actualRuntime.join(',')}] want [${expectedRuntime.join(',')}]`,
      );
    }
    const { runtime: dtsRuntime, types: dtsTypes } = parseDtsExportSets(readFileSync(dtsAbs, 'utf8'));
    if (JSON.stringify(dtsRuntime) !== JSON.stringify(expectedRuntime)) {
      failures.push(`importGraph: declaration runtime export drift in ${entry}`);
    }
    const expectedTypes = [...meta.inventory.types].sort();
    if (JSON.stringify(dtsTypes) !== JSON.stringify(expectedTypes)) {
      failures.push(
        `importGraph: declaration type export drift in ${entry}: got [${dtsTypes.join(',')}] want [${expectedTypes.join(',')}]`,
      );
    }
  }
  const brokerRoot = await import(pathToFileURL(resolve(rootDir, DIST_ENTRIES['@sentropic/mcp-broker'].dist)).href);
  for (const key of Object.keys(brokerRoot)) {
    if (/memory-reference|SqliteMemoryWorkflowStore|ConnectorRegistry|createInMemoryContext|DuplicateConnector/i.test(key)) {
      failures.push(`importGraph: broker root loads unqualified surface ${key}`);
    }
  }
  const platformRootSpecifiers = readFileSync(resolve(rootDir, 'packages/mcp-platform/src/index.ts'), 'utf8');
  if (/memory/.test(platformRootSpecifiers)) {
    failures.push('importGraph: platform root barrel references memory');
  }
}

async function main() {
  const rootDir = resolve(arg('--root') || join(HERE, '..', '..'));
  const failures = [];
  const { failures: scanFailures, edges, resolvedFiles } = scanSourceGraph(rootDir);
  failures.push(...scanFailures);
  await checkExportInventory(rootDir, failures);
  const report = {
    roots: SOURCE_ROOTS,
    resolvedFiles,
    edges,
    forbiddenHits: failures.filter((f) => f.includes('forbidden')).length,
    unresolvedEdges: failures.filter((f) => f.includes('unresolved') || f.includes('sibling')).length,
    failures,
  };
  if (arg('--json') !== null || process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
  } else {
    console.log(`import-graph: ok (${resolvedFiles.length} files, ${edges.length} edges)`);
  }
  process.exit(failures.length > 0 ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
