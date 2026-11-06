import { createHash } from 'node:crypto';
import { ArtifactOperationError } from './failures.js';
import { assertGitTarget, gitPath } from './git-port-policy.js';
import { liveTextValid, overlayBytes } from './live-crypto.js';
import type { GitPort, GitPortRepository, GitPortTarget, GitTreeEntry } from './git-port.js';
import type { LiveOverlayEntry } from './live-store.js';
export interface LiveBaseTree { treeSha: string; entries: GitTreeEntry[] }
export interface LiveMutation {
  edits?: { path: string; oldStr: string; newStr: string }[];
  files?: { path: string; text: string }[]; deletes?: string[];
}
export function validateLiveMutation(repo: GitPortRepository, target: GitPortTarget, input: LiveMutation,
  maxPaths = 255, maxBytes = 2 * 1024 * 1024): void {
  assertGitTarget(repo, target, true);
  const seen = new Set<string>(); let bytes = 0;
  for (const kind of ['edits', 'files', 'deletes'] as const) {
    const array = input[kind];
    if (array === undefined) continue;
    if (!Array.isArray(array) || !array.length) throw new ArtifactOperationError('invalid_request');
    if (kind === 'edits' && array.length > 100) throw new ArtifactOperationError('limit_exceeded');
    for (const value of array) {
      const path = typeof value === 'string' ? value : value?.path;
      if (typeof path !== 'string' || seen.has(path)) throw new ArtifactOperationError('invalid_request');
      gitPath(repo, target, path, true); seen.add(path);
      if (path.split('/').some(part => /^package.*\.json$/i.test(part)) ||
        ['.github/**', 'deploy/**', 'api/**', '.track/**', 'packages/immo-mcp/**'].some(glob =>
          path === glob.slice(0, -3) || path.startsWith(glob.slice(0, -2)))) throw new ArtifactOperationError('git_path_refused');
      if (typeof value !== 'string') {
        const keys = kind === 'edits' ? ['path', 'oldStr', 'newStr'] : ['path', 'text'];
        if (Object.keys(value).some(key => !keys.includes(key))) throw new ArtifactOperationError('invalid_request');
        for (const key of keys.filter(key => key !== 'path')) {
          const text = (value as unknown as Record<string, unknown>)[key];
          if (typeof text !== 'string' || !liveTextValid(text) || (key === 'oldStr' && !text)) throw new ArtifactOperationError('invalid_request');
          if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(text)) throw new ArtifactOperationError('git_path_refused');
          bytes += Buffer.byteLength(text);
        }
      }
    }
  }
  if (!seen.size) throw new ArtifactOperationError('invalid_request');
  if (seen.size > maxPaths || bytes > maxBytes) throw new ArtifactOperationError('limit_exceeded');
}
/** Compute actual Git object IDs without creating forge objects, preserving all excluded base entries. */
export function liveTreeSha(base: LiveBaseTree, overlay: LiveOverlayEntry[], target: GitPortTarget): string {
  const algorithm = base.treeSha.length === 64 ? 'sha256' : 'sha1';
  const objectId = (kind: string, bytes: Buffer) => createHash(algorithm)
    .update(Buffer.from(`${kind} ${bytes.length}\0`)).update(bytes).digest('hex');
  const files = new Map(base.entries.map(entry => [entry.path, { mode: entry.mode, sha: entry.sha }]));
  for (const entry of overlay) {
    const path = target.subPath ? target.subPath + '/' + entry.path : entry.path;
    if (entry.text === null) files.delete(path);
    else files.set(path, { mode: entry.mode, sha: objectId('blob', Buffer.from(entry.text)) });
  }
  type Node = { files: Map<string, { mode: string; sha: string }>; directories: Map<string, Node> };
  const node = (): Node => ({ files: new Map(), directories: new Map() });
  const root = node();
  for (const [path, file] of files) {
    const parts = path.split('/'); let current = root;
    for (const part of parts.slice(0, -1)) {
      if (!current.directories.has(part)) current.directories.set(part, node());
      current = current.directories.get(part)!;
    }
    current.files.set(parts.at(-1)!, file);
  }
  function hash(current: Node): string {
    const entries = [...current.files].map(([name, entry]) => ({ name, ...entry, directory: false }));
    for (const [name, child] of current.directories) entries.push({ name, mode: '40000', sha: hash(child), directory: true });
    entries.sort((a, b) => Buffer.compare(Buffer.from(a.name + (a.directory ? '/' : '')), Buffer.from(b.name + (b.directory ? '/' : ''))));
    return objectId('tree', Buffer.concat(entries.map(entry => Buffer.concat([
      Buffer.from(`${entry.mode.replace(/^0/, '')} ${entry.name}\0`), Buffer.from(entry.sha, 'hex')]))));
  }
  return hash(root);
}
export async function applyLiveMutation(git: GitPort, target: GitPortTarget, base: LiveBaseTree,
  baseHeadSha: string, before: LiveOverlayEntry[], input: LiveMutation): Promise<LiveOverlayEntry[]> {
  const overlay = new Map(before.map(entry => [entry.path, entry]));
  const baseEntry = (path: string) => base.entries.find(entry => entry.path === (target.subPath ? target.subPath + '/' : '') + path);
  const cache = new Map<string, string>();
  async function textAtBase(path: string): Promise<string | undefined> {
    if (!baseEntry(path)) return undefined;
    if (!cache.has(path)) {
      const file = (await git.read(target, { commitSha: baseHeadSha, paths: [path] })).files[0];
      if (!file || !('text' in file)) throw new ArtifactOperationError('edit_mismatch');
      cache.set(path, file.text);
    }
    return cache.get(path)!;
  }
  async function put(path: string, text: string | null): Promise<void> {
    const full = (target.subPath ? target.subPath + '/' : '') + path;
    const entry = baseEntry(path);
    if (base.entries.some(e => e.path.startsWith(full + '/') || (full.startsWith(e.path + '/') && e.type !== 'tree')) ||
      (entry && (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)))) throw new ArtifactOperationError('git_path_refused');
    if (text === null && !entry) {
      if (overlay.get(path)?.text === undefined || overlay.get(path)?.text === null) throw new ArtifactOperationError('invalid_request');
      overlay.delete(path); return;
    }
    if (text !== null && Buffer.byteLength(text) > 1024 * 1024) throw new ArtifactOperationError('limit_exceeded');
    if (text !== null && entry && text === await textAtBase(path)) overlay.delete(path);
    else overlay.set(path, { path, text, mode: entry?.mode ?? '100644' });
  }
  for (const edit of input.edits ?? []) {
    const text = overlay.has(edit.path) ? overlay.get(edit.path)!.text : await textAtBase(edit.path);
    const first = text?.indexOf(edit.oldStr) ?? -1;
    if (text === null || text === undefined || first < 0 || text.indexOf(edit.oldStr, first + 1) >= 0) throw new ArtifactOperationError('edit_mismatch');
    await put(edit.path, text.slice(0, first) + edit.newStr + text.slice(first + edit.oldStr.length));
  }
  for (const file of input.files ?? []) await put(file.path, file.text);
  for (const path of input.deletes ?? []) await put(path, null);
  const result = [...overlay.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  overlayBytes(result);
  return result;
}
