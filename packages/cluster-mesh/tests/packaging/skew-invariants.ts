// Registry-state independent invariants of the packed skewed-tuple fixtures. prepare.sh records the exact npm
// outcomes (npm-install-detail); which npm-valid outcome occurred depends on npm and on what the registry
// publishes, so it is printed, never asserted. Each check returns violations (empty = invariant holds).

export type Detail = Readonly<Record<string, string>>;

export interface SkewTuple {
  /** Exact candidate identity, e.g. `@sentropic/cluster-mesh@0.13.0`. */
  readonly candidate: string;
  /** Out-of-range llm-mesh / llm-gateway versions of the skewed tree. */
  readonly mesh: RegExp;
  readonly gateway: RegExp;
}

const version = (installed: string, name: string): string =>
  installed.split(' ').find((entry) => entry.startsWith(`${name}@`))?.slice(name.length + 1) ?? 'absent';

const isSkewed = (installed: string, tuple: SkewTuple): boolean =>
  version(installed, '@sentropic/cluster-mesh') === tuple.candidate.split('@').pop()
  && tuple.mesh.test(version(installed, '@sentropic/llm-mesh'))
  && tuple.gateway.test(version(installed, '@sentropic/llm-gateway'));

/**
 * (a) The plain install never ends with the skewed tuple installed: either npm exits non-zero with ERESOLVE, or it
 * exits 0 with neither old train package installed. (b) The recorded skew build (one of `builders`) exited 0 and
 * produced exactly the skewed tuple.
 */
export function npmSkewViolations(detail: Detail, tuple: SkewTuple, builders: readonly string[]): string[] {
  const out: string[] = [];
  for (const key of ['plain-exit', 'plain-eresolve', 'plain-installed', 'skew-build']) {
    if (detail[key] === undefined) out.push(`missing ${key}`);
  }
  if (out.length) return out;
  const plain = detail['plain-installed']!;
  if (detail['plain-exit'] !== '0') {
    if (detail['plain-eresolve'] !== 'yes') out.push(`plain install exited ${detail['plain-exit']} without ERESOLVE`);
  } else if (tuple.mesh.test(version(plain, '@sentropic/llm-mesh'))
    || tuple.gateway.test(version(plain, '@sentropic/llm-gateway'))) {
    out.push(`plain install accepted an out-of-range train package: ${plain}`);
  }
  if (isSkewed(plain, tuple)) out.push(`plain install built the skewed tuple: ${plain}`);
  const skew = detail['skew-build']!;
  if (!builders.includes(skew)) {
    out.push(`skew-build ${skew} is not one of ${builders.join(', ')}`);
    return out;
  }
  if (detail[`${skew}-exit`] !== '0') out.push(`${skew} install exited ${detail[`${skew}-exit`] ?? 'unrecorded'}`);
  const built = detail[`${skew}-installed`] ?? '';
  if (!isSkewed(built, tuple)) out.push(`${skew} install did not build the skewed tuple: ${built}`);
  return out;
}

export type Refusal = { code?: string; reason?: string; message?: string };
export type Probe = {
  preflight: Refusal | string;
  load: (Refusal & Record<string, string>) | string;
  entries: Record<string, Refusal | string>;
};

const TOPOLOGY = { code: 'cluster_mesh_topology_invalid', reason: 'incompatible_version' };

/** Every guarded entry, the preflight and modules.load('gateway') refuse the skewed tree with incompatible_version. */
export function runtimeRefusalViolations(probe: Probe, entries: readonly string[], tuple: SkewTuple): string[] {
  const out: string[] = [];
  const named = new RegExp(`installed @sentropic/llm-mesh@${tuple.mesh.source.replace(/^\^|\$$/gu, '')} at \\S+ `
    + 'does not satisfy the required range ">=0\\.22\\.0 <0\\.23\\.0"', 'u');
  const topology = (label: string, value: Refusal | string | undefined): void => {
    if (typeof value !== 'object' || value.code !== TOPOLOGY.code || value.reason !== TOPOLOGY.reason
      || !named.test(value.message ?? '')) out.push(`${label} not refused with incompatible_version: ${JSON.stringify(value)}`);
  };
  topology('preflight', probe.preflight);
  for (const entry of entries) topology(entry, probe.entries[entry]);
  const load = probe.load;
  if (typeof load !== 'object' || load.code !== 'cluster_mesh_module_unavailable' || load.reason !== 'incompatible_version'
    || load.packageName !== '@sentropic/llm-gateway' || load.requiredRange !== '>=0.19.0 <0.20.0'
    || !tuple.gateway.test(load.installedVersion ?? '')) {
    out.push(`load('gateway') not refused with incompatible_version: ${JSON.stringify(load)}`);
  }
  return out;
}
