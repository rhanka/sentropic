import { createHmac, timingSafeEqual } from 'node:crypto';
import { ArtifactOperationError } from './failures.js';
import type { GitPort, GitPortRepository, GitPortTarget, GitSourcePage, GitTreeEntry } from './git-port.js';
import type { GitPortOptions, GitPortSession } from './git-port-session.js';
import { assertGitSha, gitPath } from './git-port-policy.js';
import { gitTrees } from './git-port-tree.js';

export function gitSourceReader(options: GitPortOptions, open: (repo: GitPortRepository) => Promise<GitPortSession>) {
  const mac = (data: string) => createHmac('sha256', options.cursorKey).update(data).digest('base64url');
  return async (repo: GitPortRepository, target: GitPortTarget, input: Parameters<GitPort['read']>[1]): Promise<GitSourcePage> => {
    assertGitSha(input.commitSha);
    if (input.paths && (!input.paths.length || input.paths.length > 255 || new Set(input.paths).size !== input.paths.length)) {
      throw new ArtifactOperationError('invalid_request');
    }
    input.paths?.forEach(path => gitPath(repo, target, path, false));
    const identity = mac(JSON.stringify([target, input.commitSha, input.paths ?? null]));
    let offset = 0; let total = 0;
    if (input.cursor) {
      try {
        if (input.cursor.length > 4096) throw new Error();
        const parts = input.cursor.split('.');
        if (parts.length !== 2 || !timingSafeEqual(Buffer.from(mac(parts[0])), Buffer.from(parts[1]))) throw new Error();
        const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        if (data.identity !== identity || !Number.isSafeInteger(data.offset) || data.offset < 0 ||
          !Number.isSafeInteger(data.total) || data.total < 0) throw new Error();
        offset = data.offset; total = data.total;
      } catch { throw new ArtifactOperationError('invalid_request'); }
    }
    const session = await open(repo); const trees = gitTrees(session);
    const root = await trees.root(input.commitSha);
    let entries: GitTreeEntry[];
    if (input.paths) {
      entries = [];
      for (const path of input.paths) {
        const entry = await trees.lookup(root, gitPath(repo, target, path, false));
        if (!entry) throw new ArtifactOperationError('not_found');
        if (entry.type !== 'blob') throw new ArtifactOperationError('git_path_refused', { publicDetails: { path, reason: 'not_file' } });
        entries.push({ ...entry, path });
      }
    } else entries = await trees.enumerate(root, target);
    if (offset > entries.length) throw new ArtifactOperationError('invalid_request');
    const files: GitSourcePage['files'] = [];
    const page = entries.slice(offset, offset + (options.pageSize ?? 100));
    for (const entry of page) {
      let reason: 'too_large' | 'over_total_budget' | undefined;
      const maxFile = options.maxFileBytes ?? 1024 * 1024;
      const maxTotal = options.maxTotalBytes ?? 8 * 1024 * 1024;
      if ((entry.size ?? 0) > maxFile) reason = 'too_large';
      else if (total + (entry.size ?? 0) > maxTotal) reason = 'over_total_budget';
      if (reason) { files.push({ path: entry.path, omitted: reason }); continue; }
      const bytes = await session.call((forge, context) => forge.blob(context, entry.sha));
      if (bytes.length > maxFile) reason = 'too_large';
      else if (total + bytes.length > maxTotal) reason = 'over_total_budget';
      if (reason) { files.push({ path: entry.path, omitted: reason }); continue; }
      if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(Buffer.from(bytes).toString('utf8'))) {
        throw new ArtifactOperationError('git_path_refused', { publicDetails: { path: entry.path, reason: 'private_key' } });
      }
      total += bytes.length;
      try {
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        if (bytes.includes(0)) throw new Error();
        files.push({ path: entry.path, text, encoding: 'utf-8' });
      } catch { files.push({ path: entry.path, base64: Buffer.from(bytes).toString('base64'), encoding: 'base64' }); }
    }
    const next = offset + page.length;
    const payload = Buffer.from(JSON.stringify({ identity, offset: next, total })).toString('base64url');
    return { commitSha: input.commitSha, treeSha: root, files,
      nextCursor: next < entries.length ? `${payload}.${mac(payload)}` : null };
  };
}
