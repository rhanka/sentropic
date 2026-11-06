import { readFileSync } from 'node:fs';

export const baseline = JSON.parse(readFileSync(new URL('./unit-shards-baseline.json', import.meta.url), 'utf8'));

// Longest processing time first. One second per file accounts for worker/import
// overhead; new files receive that weight and remain part of the collected suite.
export function balancedShards(files, count, durations = baseline.durationsMs) {
  if (!Number.isInteger(count) || count < 1 || !files.length || new Set(files).size !== files.length) {
    throw Error('Invalid unit shard inventory');
  }
  const weight = file => (durations[file] ?? 0) + 1000;
  const shards = Array.from({ length: count }, (_, index) => ({ index, files: [], weightMs: 0 }));
  for (const file of [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    const shard = [...shards].sort((a, b) => a.weightMs - b.weightMs || a.index - b.index)[0];
    shard.files.push(file);
    shard.weightMs += weight(file);
  }
  return shards;
}

export function unitShard(specs, { index, count }, root) {
  if (!Number.isInteger(index) || index < 1 || index > count) throw Error('Invalid unit shard index');
  const normalizedRoot = root.replaceAll('\\', '/').replace(/\/$/, '') + '/';
  const key = spec => spec.moduleId.replaceAll('\\', '/').slice(normalizedRoot.length);
  const files = specs.map(key);
  const selected = new Set(balancedShards(files, count)[index - 1].files);
  return specs.filter(spec => selected.has(key(spec)));
}
