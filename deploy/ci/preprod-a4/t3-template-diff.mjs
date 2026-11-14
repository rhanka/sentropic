import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, digest, tiers } from './guards.mjs';
import { wireCommands } from './ops.mjs';

// Strategic-merge keys of the pod template lists (patchMergeKey in k8s.io/api core/v1).
const MERGE_KEYS = { containers: 'name', initContainers: 'name', env: 'name', volumes: 'name',
  volumeMounts: 'mountPath', ports: 'containerPort', imagePullSecrets: 'name' };
const NAMES = ['api', 'auth-idp', 'ui'];
const isMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// P-0.8 canonical diff. `kubectl apply` is a three-way merge: it sets every rendered field,
// deletes only what the previous applied configuration owned, and keeps the rest of the live
// object (API defaults, restartedAt). The pod template changes, and a rollout starts, exactly
// when a rendered field is missing, different or ordered differently, or when an owned field
// disappears. Each such template path is one entry; an empty list means no rollout.
export function templateDiff(live, rendered, previous, path = '') {
  if (Array.isArray(rendered)) {
    const key = MERGE_KEYS[path.slice(path.lastIndexOf('/') + 1)];
    if (!key || !Array.isArray(live)) return canonical(live ?? null) === canonical(rendered) ? [] : [path];
    const id = item => String(item[key]), liveIds = live.map(id), renderedIds = rendered.map(id);
    const owned = Array.isArray(previous) ? previous : [];
    const out = rendered.flatMap(item => liveIds.includes(id(item))
      ? templateDiff(live[liveIds.indexOf(id(item))], item, owned.find(old => id(old) === id(item)), `${path}/${id(item)}`)
      : [`${path}/${id(item)}`]);
    if (liveIds.filter(value => renderedIds.includes(value)).join('\n')
      !== renderedIds.filter(value => liveIds.includes(value)).join('\n')) out.push(`${path}:order`);
    for (const old of owned) {
      if (!renderedIds.includes(id(old)) && liveIds.includes(id(old))) out.push(`${path}/${id(old)}:delete`);
    }
    return out;
  }
  if (isMap(rendered)) {
    if (!isMap(live)) return [path || '/'];
    const out = Object.entries(rendered).flatMap(([key, value]) => templateDiff(live[key], value, previous?.[key], `${path}/${key}`));
    for (const key of Object.keys(isMap(previous) ? previous : {})) {
      if (!(key in rendered) && key in live) out.push(`${path}/${key}:delete`);
    }
    return out;
  }
  return (live ?? null) === (rendered ?? null) ? [] : [path];
}

function local(args, input) {
  const result = spawnSync('kubectl', args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0 || result.error) throw new Error('kubectl_local_failed');
  return result.stdout;
}

// Offline conversion of a manifest stream (YAML or JSON, List or documents) to objects:
// `kubectl patch --local -o json` prints one indented document per object and reads no cluster.
export function manifests(text, run = local) {
  const output = run(['patch', '--local', '-f', '-', '--type=merge', '-p', '{}', '-o', 'json'], text);
  return output.split(/^(?=\{$)/m).filter(part => part.trim()).map(part => JSON.parse(part))
    .flatMap(object => object.kind === 'List' ? object.items : [object]);
}
export const deployments = (text, run = local) => Object.fromEntries(manifests(text, run)
  .filter(object => object.kind === 'Deployment').map(object => [object.metadata.name, object]));

// Replays on files the exact W3 wire vectors, then the annex set-image vectors.
export function wired(objects, image, annexCommands, run = local) {
  const dir = mkdtempSync(join(tmpdir(), 't3-template-'));
  try {
    return Object.fromEntries(Object.entries(objects).map(([name, object]) => {
      const file = join(dir, `${name}.json`);
      let current = JSON.stringify(object);
      for (const args of [...wireCommands(image, tiers.prod), ...annexCommands]) {
        const vector = args.slice(0, 3).join(' ') === `patch deployment ${name}` ? ['patch', '--local', '-f', file, ...args.slice(3)]
          : args.slice(0, 3).join(' ') === `set image deployment/${name}` ? ['set', 'image', '--local', '-f', file, args[3]] : null;
        if (!vector) continue;
        writeFileSync(file, current, { mode: 0o600 });
        // kubectl prints nothing when the command changes nothing (image already set).
        current = run([...vector, '-o', 'json']).trim() || current;
      }
      return [name, JSON.parse(current)];
    }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// live: `kubectl get deployment api auth-idp ui -o json` before the window; rendered: the
// kustomize output of the overlay applied after it; image and annexCommands: the attempt annex.
export function judge({ live, rendered, image, annexCommands }, run = local) {
  const before = deployments(live, run), after = deployments(rendered, run);
  if (NAMES.some(name => !before[name] || !after[name])) throw new Error('template_inventory_incomplete');
  const objects = wired(Object.fromEntries(NAMES.map(name => [name, before[name]])), image, annexCommands, run);
  const result = Object.fromEntries(NAMES.map(name => {
    const applied = before[name].metadata.annotations?.['kubectl.kubernetes.io/last-applied-configuration'];
    const [from, to] = [objects[name].spec.template, after[name].spec.template];
    return [name, { wiredSha256: digest(canonical(from)), renderedSha256: digest(canonical(to)),
      diff: templateDiff(from, to, applied ? JSON.parse(applied).spec?.template : undefined) }];
  }));
  return { version: 't3-template-diff/1', strictZero: Object.values(result).every(entry => !entry.diff.length), deployments: result };
}
