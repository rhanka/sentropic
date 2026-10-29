import { isAbsolute, relative, resolve } from 'node:path';
import { isNativeBuildProcess } from './disabled-trace.mjs';
import { existsSync, readdirSync } from 'node:fs';

function sourceBuildOutputs(consumerRoot) {
  const outputs = [];
  const objects = directory => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) objects(path);
      else if (entry.isFile() && /\.(?:o|obj)$/.test(entry.name)) outputs.push({ kind: 'native-build-output', detail: { path } });
    }
  };
  const modules = directory => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = resolve(directory, entry.name);
      if (entry.name.startsWith('@')) { modules(path); continue; }
      if (['better-sqlite3', 'fs-ext'].includes(entry.name) || path.endsWith('/@sentropic/engram')) objects(resolve(path, 'build'));
      modules(resolve(path, 'node_modules'));
    }
  };
  modules(resolve(consumerRoot, 'node_modules'));
  return outputs;
}

/** Attribute executed commands to this fresh candidate-only consumer closure. */
export function candidateNativeBuilds(rows, consumerRoot) {
  if (!Array.isArray(rows) || !isAbsolute(consumerRoot)) throw Error('native build observer inputs required');
  const compiles = rows.filter(row => {
    const detail = row?.detail;
    if (row?.kind !== 'native-build' || !detail || !isAbsolute(detail.cwd) ||
        !isNativeBuildProcess(detail.executable, detail.argv) ||
        !/^(?:cc|c\+\+|g\+\+|gcc|clang[^/\\]*)$/.test(String(detail.executable).split(/[/\\]/).at(-1))) return false;
    const path = relative(resolve(consumerRoot), resolve(detail.cwd)).replaceAll('\\', '/');
    if (!path || path === '..' || path.startsWith('../') || isAbsolute(path)) return false;
    return path === 'node_modules/@sentropic/engram' || path.startsWith('node_modules/@sentropic/engram/') ||
      /(?:^|\/)node_modules\/(?:better-sqlite3|fs-ext)(?:\/|$)/.test(path);
  });
  // A native make child need not be a Node child: retain its concrete object
  // outputs. Downloaded prebuilt .node modules alone are not source builds.
  return [...compiles, ...sourceBuildOutputs(consumerRoot)];
}

export function assertNoCandidateNativeBuilds(log, rows, consumerRoot) {
  const builds = candidateNativeBuilds(rows, consumerRoot);
  // npm declarations and unrelated optional dependencies are diagnostics, never attribution.
  if (builds.length) throw Error('disabled install: candidate native build attempts observed: ' +
    JSON.stringify(builds) + '\nInstall log excerpt:\n' + String(log).slice(-2000));
  return { candidateNativeBuildCount: 0 };
}
