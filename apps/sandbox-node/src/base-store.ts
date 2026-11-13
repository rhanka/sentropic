import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, chmod } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NODE_ROOT, type TenantBase } from './mounts.js';

export async function ensureBase(base: TenantBase, url: string,
  options: { root?: string; fetchBase?: typeof fetch } = {}): Promise<string> {
  if (!['sentropic', 'immo'].includes(base.tenantId) || !/^[a-zA-Z0-9_-]+$/.test(base.baseId)
    || !['rootfs', 'source', 'dependencies', 'prebundle', 'vendor-esm'].includes(base.kind)
    || !/^[a-f0-9]{64}$/.test(base.identityDigest) || !url.startsWith('https://')) throw new Error('invalid base import');
  const path = join(options.root ?? NODE_ROOT, 'tenants', base.tenantId, 'bases', base.kind, `${base.identityDigest}.erofs`);
  const verify = async () => {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    if (hash.digest('hex') !== base.identityDigest) throw new Error('base digest mismatch');
  };
  if (existsSync(path)) { await verify(); return path; }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.part`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    const response = await (options.fetchBase ?? fetch)(url, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) throw new Error('base download failed');
    const hash = createHash('sha256'); let size = 0;
    const reader = response.body.getReader();
    while (true) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      size += chunk.length;
      if (size > 1024 * 1024 * 1024) throw new Error('base exceeds 1 GiB');
      hash.update(chunk); await file.writeFile(chunk);
    }
    if (hash.digest('hex') !== base.identityDigest) throw new Error('base digest mismatch');
    await file.sync(); await chmod(temporary, 0o400); await rename(temporary, path);
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    return path;
  } finally { await file.close(); await rm(temporary, { force: true }); }
}
