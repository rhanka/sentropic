import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// npm's own semver implementation is supplied by the isolated Make toolset.
import semver from 'semver';

export async function verifyAuthGraph(requirements, lookup, seen = new Set()) {
  for (const [name, range] of Object.entries(requirements)) {
    if (!semver.validRange(range)) throw new Error(`Non-registry dependency: ${name}`);
    const floor = semver.minVersion(range)?.version;
    if (!floor) throw new Error(`Missing dependency floor: ${name}`);
    const key = `${name}@${floor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const manifest = await lookup(name, floor);
    if (manifest.name !== name || manifest.version !== floor) {
      throw new Error(`Registry metadata mismatch: ${key}`);
    }
    // Check each edge separately: a peer must not hide a dependency with the same name.
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      await verifyAuthGraph(manifest[field] ?? {}, lookup, seen);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const attempts = Number(process.argv[2] ?? 12);
  const seconds = Number(process.argv[3] ?? 5);
  if (!Number.isInteger(attempts) || attempts < 1 || !Number.isFinite(seconds) || seconds < 0) {
    throw new Error('Invalid registry wait bounds');
  }
  for (let attempt = 1; ; attempt++) {
    try {
      await verifyAuthGraph(pkg.peerDependencies, (name, version) => JSON.parse(
        execFileSync('npm', ['view', `${name}@${version}`, '--json'], {
          encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
        }),
      ));
      break;
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.error(`Auth registry graph unavailable (${attempt}/${attempts})`);
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }
  }
}
