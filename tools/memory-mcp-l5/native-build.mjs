import { isAbsolute, relative, resolve } from 'node:path';
import { isNativeBuildProcess } from './disabled-trace.mjs';

/** Attribute executed commands to this fresh candidate-only consumer closure. */
export function candidateNativeBuilds(rows, consumerRoot) {
  if (!Array.isArray(rows) || !isAbsolute(consumerRoot)) throw Error('native build observer inputs required');
  return rows.filter(row => {
    const detail = row?.detail;
    if (row?.kind !== 'native-build' || !detail || !isAbsolute(detail.cwd) ||
        !isNativeBuildProcess(detail.executable, detail.argv)) return false;
    const path = relative(resolve(consumerRoot), resolve(detail.cwd)).replaceAll('\\', '/');
    if (!path || path === '..' || path.startsWith('../') || isAbsolute(path)) return false;
    return path === 'node_modules/@sentropic/engram' || path.startsWith('node_modules/@sentropic/engram/') ||
      /(?:^|\/)node_modules\/(?:better-sqlite3|fs-ext)(?:\/|$)/.test(path);
  });
}

export function assertNoCandidateNativeBuilds(log, rows, consumerRoot) {
  const builds = candidateNativeBuilds(rows, consumerRoot);
  // npm declarations and unrelated optional dependencies are diagnostics, never attribution.
  if (builds.length) throw Error('disabled install: candidate native build attempts observed: ' +
    JSON.stringify(builds) + '\nInstall log excerpt:\n' + String(log).slice(-2000));
  return { candidateNativeBuildCount: 0 };
}
