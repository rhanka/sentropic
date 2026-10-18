import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectArchive } from '../ci/publishable-manifests.mjs';
import { PUBLIC_LIBRARIES } from './packages.mjs';

export function topologicalOrder(packages) {
  const byName = new Map(packages.map((p) => [p.manifest.name, p]));
  if (byName.size !== packages.length) throw new Error('Duplicate package identity');
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];
  const visit = (pkg) => {
    const name = pkg.manifest.name;
    if (visiting.has(name)) throw new Error(`Dependency cycle: ${name}`);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const dependency of Object.keys(pkg.manifest[section] ?? {})) {
        if (byName.has(dependency)) visit(byName.get(dependency));
      }
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(pkg);
  };
  packages.forEach(visit);
  return ordered;
}

export function planArchives(slugs, { directory, headSha }) {
  if (!slugs.length || new Set(slugs).size !== slugs.length || slugs.some((s) => !PUBLIC_LIBRARIES.includes(s))) {
    throw new Error('PKGS must contain distinct declared public library slugs');
  }
  if (!/^[a-f0-9]{40}$/.test(headSha ?? '')) throw new Error('Expected an exact build commit SHA');
  return topologicalOrder(slugs.map((slug) => {
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, `${slug}.receipt.json`), 'utf8'));
    if (receipt.slug !== slug || receipt.guard !== 'pass' || receipt.manifest_mode !== 'block' || receipt.head_sha !== headSha) {
      throw new Error(`${slug}: missing successful strict guard for the current commit`);
    }
    const archive = path.join(directory, slug, path.basename(receipt.archive ?? ''));
    const sha256 = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    if (sha256 !== receipt.sha256) throw new Error(`${slug}: archive changed after verification`);
    const result = inspectArchive({ archive });
    if (result.structural.length || result.findings.length || result.name !== `@sentropic/${slug}` || result.name !== receipt.name || result.version !== receipt.version) {
      throw new Error(`${slug}: packed manifest does not match the verified identity`);
    }
    return { slug, archive, manifest: result.packed, sha256 };
  }));
}
