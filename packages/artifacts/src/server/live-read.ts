import { randomUUID } from 'node:crypto';
import { ArtifactOperationError } from './failures.js';
import { gitPath } from './git-port-policy.js';
import { liveDigest } from './live-crypto.js';
import type { GitPort } from './git-port.js';
import type { LiveAuthority, LiveInvocation, LiveSnapshot } from './live-contracts.js';
import type { LiveDraftRecord, LiveOverlayEntry } from './live-store.js';
import type { LiveBaseTree } from './live-tree.js';

export async function readLivePage(input: { git: GitPort; authority: LiveAuthority; record: LiveDraftRecord;
  overlay: LiveOverlayEntry[]; base: LiveBaseTree; args: Record<string, any>; invocation: LiveInvocation;
  kind: 'read' | 'diff'; now: number }): Promise<Record<string, unknown>> {
  const { git, authority, record, overlay, base, args, invocation, kind, now } = input;
  let snapshot: LiveSnapshot = { actorId: invocation.actorId, revision: record.revision,
    baseHeadSha: record.baseHeadSha, offset: 0, kind, expiresAt: now + 15 * 60000,
    ...(args.paths ? { paths: args.paths } : {}) };
  if (args.cursor) {
    const saved = record.snapshots?.[args.cursor];
    if (!saved || saved.expiresAt <= now || saved.actorId !== invocation.actorId || saved.kind !== kind ||
      saved.revision !== record.revision || saved.baseHeadSha !== record.baseHeadSha) throw new ArtifactOperationError('git_live_snapshot_expired');
    if (args.paths && JSON.stringify(args.paths) !== JSON.stringify(saved.paths)) throw new ArtifactOperationError('invalid_request');
    snapshot = saved;
  }
  if (args.expectedLiveRevision && args.expectedLiveRevision !== record.revision) throw new ArtifactOperationError('git_live_revision_moved');
  const prefix = authority.target.subPath ? authority.target.subPath + '/' : '';
  const baseEntries = new Map(base.entries.filter(e => e.path.startsWith(prefix)).map(e => [e.path.slice(prefix.length), e]));
  const changes = new Map(overlay.map(e => [e.path, e]));
  const candidates = kind === 'diff' ? overlay.map(e => e.path) : snapshot.paths ??
    [...new Set([...baseEntries.keys(), ...changes.keys()])].sort();
  const paths = candidates.filter(path => {
    if (kind === 'read' && changes.get(path)?.text === null) return false;
    try { gitPath(authority.repository, authority.target, path, false); return true; }
    catch (cause) { if (snapshot.paths) throw cause; return false; }
  });
  const files: Record<string, unknown>[] = []; const diff: Record<string, unknown>[] = [];
  const recipe: { path: string; text: string }[] = []; const deletes: string[] = [];
  let bytes = 0; let offset = snapshot.offset;
  while (offset < paths.length && files.length + diff.length < 32) {
    const path = paths[offset]; const change = changes.get(path); const entry = baseEntries.get(path);
    let text = change?.text; let omitted: string | undefined;
    if (text === undefined && entry) {
      if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) omitted = 'path_alias';
      else if ((entry.size ?? 0) > 1024 * 1024) omitted = 'too_large';
      else {
        const file = (await git.read(authority.target, { commitSha: record.baseHeadSha, paths: [path] })).files[0];
        if (file && 'text' in file) text = file.text;
        else omitted = file && 'omitted' in file ? file.omitted : 'binary';
      }
    }
    if (text === undefined && !entry) throw new ArtifactOperationError('not_found');
    const size = text === null || text === undefined ? 0 : Buffer.byteLength(text);
    if (bytes + size > 2 * 1024 * 1024) break;
    bytes += size; offset++;
    if (kind === 'read') files.push({ path, ...(omitted ? { omitted } :
      { text, mode: change?.mode ?? entry?.mode, encoding: 'utf-8' }) });
    else {
      diff.push({ path, action: text === null ? 'delete' : entry ? 'replace' : 'create',
        oldDigest: entry?.sha ?? null, newDigest: text === null ? null : liveDigest(text!),
        mode: change!.mode, ...(text === null ? {} : { text }) });
      if (text === null) deletes.push(path); else recipe.push({ path, text: text! });
    }
  }
  let nextCursor: string | null = null;
  if (offset < paths.length) {
    nextCursor = randomUUID();
    const retained = Object.entries(record.snapshots ?? {}).filter(([, value]) => value.expiresAt > now).slice(-31);
    record.snapshots = Object.fromEntries([...retained, [nextCursor, { ...snapshot, offset }]]);
  }
  if (kind === 'read' && record.runtime) {
    record.runtime.lastAccessAt = new Date(now).toISOString();
    record.runtime.idleDeadline = new Date(now + 600000).toISOString();
  }
  return kind === 'read' ? { files, nextCursor } : { diff, files: recipe, deletes, nextCursor };
}
