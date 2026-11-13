import { createHash } from 'node:crypto';
import { openSync, readSync, closeSync } from 'node:fs';

/** Bounded scratch space under the agent's 192M limit, including runsc requalification. */
export function fileDigest(path: string): string {
  const fd = openSync(path, 'r'), hash = createHash('sha256'), bytes = Buffer.alloc(1024 * 1024);
  try {
    for (;;) {
      const n = readSync(fd, bytes, 0, bytes.length, null);
      if (!n) return hash.digest('hex');
      hash.update(bytes.subarray(0, n));
    }
  } finally { closeSync(fd); }
}
