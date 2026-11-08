import { createHash } from 'node:crypto';
import type { DraftSnapshot, LivePorts } from './ports';
import { conflict, LiveError, type LiveKey } from './records';
import { podName } from './pods';
import type { SupervisorSources } from './supervisor';
import { rowOf, type RemoteRows } from './remote-live';

export interface DraftFile { path: string; mode: number; bytes: Uint8Array }
/** A-LIVE §3.2 overlay (255 paths, 1 MiB per file, 8 MiB), pushed as at most 32 pages of at most 1 MiB of file bytes. */
export const DRAFT_LIMITS = Object.freeze({ paths: 255, fileBytes: 1024 * 1024, totalBytes: 8 * 1024 * 1024,
  pageBytes: 1024 * 1024, pages: 32 });
type Page = Array<{ path: string; mode: number; data: string }>;
interface Header { generation: number; revision: string; slot: 0 | 1; pages: string[] }
interface Sealed extends Header { baseHeadSha: string; treeSha: string; deletes: string[] }
interface Staging extends Header { paths: string[]; bytes: number }
interface DraftRow { sealed: Sealed | null; staging: Staging | null }
export interface SealInput { generation: number; revision: string; pages: number; baseHeadSha: string; treeSha: string;
  deletes: readonly string[] }

const limit = (): never => { throw new LiveError('limit_exceeded'); };
const duplicate = (): never => { throw new LiveError('invalid_request', 'duplicate_path'); };
const digest = (page: Page) => createHash('sha256').update(JSON.stringify(page)).digest('hex');
const snapshot = (d: Sealed): DraftSnapshot => ({ generation: d.generation, revision: d.revision, baseHeadSha: d.baseHeadSha,
  treeSha: d.treeSha, dirty: d.pages.length + d.deletes.length > 0 });
const other = (row: DraftRow | undefined): 0 | 1 => (row?.sealed?.slot === 0 ? 1 : 0);

/**
 * Remote `drafts` adapter (D0): the host owns the encrypted draft store and pushes each durable revision as bounded pages
 * sealed under its opaque revision. Pages are staged in the slot the sealed draft does not use, so a restore never reads
 * a page being staged; every page is digest-checked on read, so a concurrent overwrite fails closed.
 */
export function createRemoteDrafts(rows: RemoteRows) {
  const draftRow = (binding: string) => rowOf(binding, 'draft');
  async function sealed(binding: string, generation: number) {
    const draft = (await rows.read<DraftRow>(draftRow(binding)))?.sealed;
    if (!draft) return conflict('draft_not_staged');
    if (draft.generation !== generation) conflict('stale_fence');
    return draft;
  }
  const drafts: LivePorts['drafts'] = {
    current: async (key, generation) => snapshot(await sealed(podName(key), generation)),
    // The host owns the draft: a clean draft behind a new head is restaged by the host, never advanced here.
    advanceClean: async () => { throw new LiveError('git_live_draft_conflict'); },
    /** The host made the revision durable before pushing it; this verifies the builder copy is still that revision. */
    async checkpoint(key, draft) {
      const current = await sealed(podName(key), draft.generation);
      if (current.revision !== draft.revision || current.baseHeadSha !== draft.baseHeadSha || current.treeSha !== draft.treeSha) {
        throw new LiveError('git_live_revision_moved');
      }
    },
  };
  /** `SupervisorSources.draft`: the complete overlay of the exact sealed revision. */
  const draft: SupervisorSources['draft'] = async (runtime, wanted) => {
    const d = await sealed(runtime.podName, runtime.generation);
    if (d.revision !== wanted.revision || d.generation !== wanted.generation) conflict('stale_fence');
    const files: DraftFile[] = [];
    for (const [index, hash] of d.pages.entries()) {
      const page = await rows.read<Page>(rowOf(runtime.podName, 'page', d.slot, index));
      if (!page || digest(page) !== hash) conflict('stale_fence');
      for (const f of page) files.push({ path: f.path, mode: f.mode, bytes: new Uint8Array(Buffer.from(f.data, 'base64')) });
    }
    return { files, deletes: [...d.deletes] };
  };
  /** One page of the revision being staged: page 0 starts it, the next pages follow in order; replaying the last page
   * is a no-op. */
  async function page(key: LiveKey, input: { generation: number; revision: string; page: number; files: readonly DraftFile[] }) {
    const binding = podName(key); const index = input.page;
    if (input.files.length === 0) throw new LiveError('invalid_request', 'empty_page');
    if (index >= DRAFT_LIMITS.pages || input.files.length > DRAFT_LIMITS.paths) limit();
    const bytes = input.files.reduce((total, f) => total + f.bytes.byteLength, 0);
    if (bytes > DRAFT_LIMITS.pageBytes || input.files.some(f => f.bytes.byteLength > DRAFT_LIMITS.fileBytes)) limit();
    const content: Page = input.files.map(f => ({ path: f.path, mode: f.mode, data: Buffer.from(f.bytes).toString('base64') }));
    const hash = digest(content);
    const same = (s: Staging | null | undefined): s is Staging => !!s && s.revision === input.revision && s.generation === input.generation;
    const before = await rows.read<DraftRow>(draftRow(binding));
    if (before?.sealed && input.generation < before.sealed.generation) conflict('stale_fence');
    const staging = same(before?.staging) ? before.staging : null;
    if (index > 0 && !staging) conflict('staging_moved');
    if (staging && index === staging.pages.length - 1 && staging.pages[index] === hash) return;
    const slot = index > 0 && staging ? staging.slot : other(before);
    await rows.update<Page, void>(rowOf(binding, 'page', slot, index), () => ({ next: content, result: undefined }));
    await rows.update<DraftRow, void>(draftRow(binding), current => {
      if (current?.sealed?.slot === slot) conflict('staging_moved');
      const base: Staging = index === 0 ? { generation: input.generation, revision: input.revision, slot, pages: [], paths: [], bytes: 0 }
        : same(current?.staging) && current.staging.pages.length === index && current.staging.slot === slot ? current.staging
          : conflict('staging_moved');
      const paths = [...base.paths, ...input.files.map(f => f.path)];
      if (new Set(paths).size !== paths.length) duplicate();
      if (paths.length > DRAFT_LIMITS.paths || base.bytes + bytes > DRAFT_LIMITS.totalBytes) limit();
      return { next: { sealed: current?.sealed ?? null, staging: { ...base, pages: [...base.pages, hash], paths, bytes: base.bytes + bytes } },
        result: undefined };
    });
  }
  /** Seals the staged pages (none for a clean or deletion-only draft) as the current draft; a replay is a no-op. */
  const seal = (key: LiveKey, input: SealInput) => rows.update<DraftRow, void>(draftRow(podName(key)), current => {
    const s = current?.sealed;
    if (s && input.generation < s.generation) conflict('stale_fence');
    if (s && s.revision === input.revision && s.generation === input.generation && s.pages.length === input.pages
      && s.baseHeadSha === input.baseHeadSha && s.treeSha === input.treeSha && s.deletes.join('\0') === input.deletes.join('\0')) {
      return { result: undefined };
    }
    const staging = current?.staging;
    const staged = input.pages === 0 ? null : staging && staging.revision === input.revision && staging.generation === input.generation
      && staging.pages.length === input.pages ? staging : conflict('staging_moved');
    const paths = new Set(staged?.paths ?? []);
    if (new Set(input.deletes).size !== input.deletes.length || input.deletes.some(path => paths.has(path))) duplicate();
    if (paths.size + input.deletes.length > DRAFT_LIMITS.paths) limit();
    const next: Sealed = { generation: input.generation, revision: input.revision, baseHeadSha: input.baseHeadSha,
      treeSha: input.treeSha, deletes: [...input.deletes], slot: staged?.slot ?? other(current), pages: staged?.pages ?? [] };
    return { next: { sealed: next, staging: null }, result: undefined };
  });
  return { drafts, draft, page, seal };
}
export type RemoteDrafts = ReturnType<typeof createRemoteDrafts>;
