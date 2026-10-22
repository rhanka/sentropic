import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const root = resolve('..');
const excluded = new Set(['node_modules', 'dist', '.cache', '.git', 'SHA256SUMS']);
const files = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported delivery entry: ${path}`);
  }
}
walk(root);
const manifest = files.sort().map(path =>
  `${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${relative(root, path)}`
).join('\n') + '\n';
writeFileSync(resolve(root, 'SHA256SUMS'), manifest);
console.log(`SHA256SUMS: ${files.length} delivery files.`);
