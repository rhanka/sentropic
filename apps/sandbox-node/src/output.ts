import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Called only after the complete sandbox cgroup has become empty. No dereferencing. */
export function readOutput(root: string, subPath: string, maxBytes = 64 * 1024 * 1024): Buffer {
  if (subPath !== 'ui/dist' || !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 64 * 1024 * 1024) {
    throw new Error('invalid output path or byte limit');
  }
  let bytes = 0, entries = 0;
  const inspect = (path: string) => {
    const stat = lstatSync(path);
    if (++entries > 100_000 || stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || stat.nlink > 1 && stat.isFile()) {
      throw new Error('unsafe output entry');
    }
    if (stat.isFile()) { bytes += stat.size; if (bytes > maxBytes) throw new Error('output exceeds byte limit'); }
    else for (const name of readdirSync(path)) inspect(join(path, name));
  };
  inspect(root);
  return execFileSync('tar', ['-czf', '-', '-C', root, '.'], { maxBuffer: maxBytes, timeout: 5000 });
}
