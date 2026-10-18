// Owner-operated only. Authentication and npm configuration stay in the disposable container.
import { spawnSync } from 'node:child_process';
import { planArchives } from './archive-plan.mjs';
import { loadSemver, REGISTRY } from '../ci/publishable-manifests.mjs';

const slugs = process.argv.slice(2);
const plan = planArchives(slugs, { directory: '/input', headSha: process.env.BOOTSTRAP_HEAD_SHA });
const npm = (args, inherit = false) => {
  const result = spawnSync('npm', args, { cwd: '/session', stdio: inherit ? 'inherit' : 'pipe', encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
};
const selected = new Map(plan.map((p) => [p.manifest.name, p.manifest]));
// Resolve every dependency before prompting the owner. Network errors fail closed.
for (const { manifest } of plan) {
  const lookup = npm(['view', manifest.name, 'version', '--json', `--registry=${REGISTRY}`]);
  if (lookup.status === 0) throw new Error(`${manifest.name} already exists; configure its Trusted Publisher and use CI`);
  let error;
  try { error = JSON.parse(lookup.stdout).error; } catch { /* npm may write only stderr on failure. */ }
  if (error?.code !== 'E404') throw new Error(`${manifest.name}: registry lookup failed before login`);
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(manifest[section] ?? {})) {
      if (selected.has(name)) {
        if (!loadSemver().satisfies(selected.get(name).version, range)) throw new Error(`${name}: selected version does not satisfy ${range}`);
      } else {
        const dependency = npm(['view', `${name}@${range}`, 'version', '--json', `--registry=${REGISTRY}`]);
        if (dependency.status !== 0 || !dependency.stdout.trim() || dependency.stdout.trim() === '[]') throw new Error(`Unavailable dependency: ${name}@${range}`);
      }
    }
  }
}
console.log('Verified first-publication order:');
for (const { manifest, sha256 } of plan) console.log(`${manifest.name}@${manifest.version} sha256=${sha256}`);
try {
  const login = npm(['login', '--auth-type=web', `--registry=${REGISTRY}`, '--scope=@sentropic'], true);
  if (login.status !== 0) throw new Error('Web login did not complete');
  for (const { archive, manifest } of plan) {
    // Local web sessions cannot produce GitHub Actions SLSA provenance. CI releases require it.
    const result = npm(['publish', archive, '--access=public', '--provenance=false', '--ignore-scripts', `--registry=${REGISTRY}`], true);
    if (result.status !== 0) throw new Error(`Publication failed: ${manifest.name}@${manifest.version}`);
  }
} finally {
  // Revoke this session where possible; --rm and tmpfs remove it on every container exit.
  npm(['logout', `--registry=${REGISTRY}`]);
}
