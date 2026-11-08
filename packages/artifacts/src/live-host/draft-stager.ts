import { ArtifactOperationError } from '../server/failures.js';
import { createLiveDraftVault } from '../server/live-drafts.js';
import type { LiveKeyPort } from '../server/live-crypto.js';
import type { LiveIdentity, LiveOverlayEntry, LiveStore } from '../server/live-store.js';

/** Builder draft paths of the host live API (s-archi contract 07/11): pages in order, then the seal, both answering 204. */
export const LIVE_DRAFT_PATHS = Object.freeze({ page: 'v1/live/draft/page', seal: 'v1/live/draft/seal' });
/** A-LIVE §3.2 overlay (255 paths, 1 MiB per file, 8 MiB), pushed as at most 32 non-empty pages of at most 1 MiB of file bytes. */
export const LIVE_DRAFT_LIMITS = Object.freeze({ paths: 255, fileBytes: 1024 * 1024, totalBytes: 8 * 1024 * 1024,
  pageBytes: 1024 * 1024, pages: 32 });

/** The current durable draft of a live identity: an overlay on `baseHeadSha` whose resulting tree is `liveTreeSha`. */
export interface LiveDraftSnapshot {
  readonly revision: string; readonly baseHeadSha: string; readonly liveTreeSha: string;
  /** `text: null` is a deletion; `mode` is the git tree mode (`100644` or `100755`). */
  readonly overlay: readonly LiveOverlayEntry[];
}
/** Host port: the current durable draft of the package store; undefined when the identity has no draft record. */
export interface LiveDraftSource { current(identity: LiveIdentity): Promise<LiveDraftSnapshot | undefined> }

export interface LiveDraftPageFile { readonly path: string; readonly mode: number; readonly data: string }
/** Closed PAGE body: artifactId, bindingGeneration, revision, page, files. */
export interface LiveDraftPageBody {
  readonly artifactId: string; readonly bindingGeneration: number; readonly revision: string; readonly page: number;
  readonly files: readonly LiveDraftPageFile[];
}
/** Closed SEAL body: an empty overlay is `pages: 0, deletes: []` with `treeSha` = the live tree. */
export interface LiveDraftSealBody {
  readonly artifactId: string; readonly bindingGeneration: number; readonly revision: string; readonly pages: number;
  readonly baseHeadSha: string; readonly treeSha: string; readonly deletes: readonly string[];
}
export interface LiveDraftPlan { readonly pages: readonly LiveDraftPageBody[]; readonly seal: LiveDraftSealBody }

const MODES: Readonly<Record<string, number>> = Object.freeze({ '100644': 0o644, '100755': 0o755 });
const limit = (): never => { throw new ArtifactOperationError('limit_exceeded'); };
const unavailable = (): never => { throw new ArtifactOperationError('provider_unavailable'); };

/** Splits a draft into wire pages and deletes within LIVE_DRAFT_LIMITS. A duplicate path or a non-regular mode fails closed. */
export function planLiveDraft(draft: LiveDraftSnapshot, identity: LiveIdentity): LiveDraftPlan {
  const head = { artifactId: identity.artifactId, bindingGeneration: identity.bindingGeneration, revision: draft.revision };
  const pages: LiveDraftPageBody[] = []; const deletes: string[] = []; const seen = new Set<string>();
  let files: LiveDraftPageFile[] = []; let pageBytes = 0; let total = 0;
  const flush = () => {
    if (files.length) pages.push({ ...head, page: pages.length, files });
    files = []; pageBytes = 0;
  };
  for (const entry of draft.overlay) {
    if (seen.has(entry.path)) unavailable();
    seen.add(entry.path);
    if (seen.size > LIVE_DRAFT_LIMITS.paths) limit();
    if (entry.text === null) { deletes.push(entry.path); continue; }
    const mode = MODES[entry.mode] ?? unavailable();
    const bytes = Buffer.from(entry.text, 'utf8');
    if (bytes.byteLength > LIVE_DRAFT_LIMITS.fileBytes) limit();
    total += bytes.byteLength;
    if (total > LIVE_DRAFT_LIMITS.totalBytes) limit();
    if (files.length && pageBytes + bytes.byteLength > LIVE_DRAFT_LIMITS.pageBytes) flush();
    files.push({ path: entry.path, mode, data: bytes.toString('base64') });
    pageBytes += bytes.byteLength;
  }
  flush();
  if (pages.length > LIVE_DRAFT_LIMITS.pages) limit();
  return { pages, seal: { ...head, pages: pages.length, baseHeadSha: draft.baseHeadSha, treeSha: draft.liveTreeSha, deletes } };
}

/** Posts one body to a builder path and returns its HTTP status; a transport failure throws. */
export type LiveDraftSend = (path: string, body: unknown) => Promise<{ status: number }>;

/** Stages the current draft: every page in order, then the seal. Anything but 204 is provider_unavailable. */
export async function stageLiveDraft(source: LiveDraftSource, identity: LiveIdentity, send: LiveDraftSend): Promise<void> {
  const draft = await source.current(identity) ?? unavailable();
  const plan = planLiveDraft(draft, identity);
  for (const page of plan.pages) if ((await send(LIVE_DRAFT_PATHS.page, page)).status !== 204) unavailable();
  if ((await send(LIVE_DRAFT_PATHS.seal, plan.seal)).status !== 204) unavailable();
}

/** The LiveDraftSource of a host on the package LiveStore: the decrypted overlay of the current record. */
export function liveStoreDrafts(store: LiveStore, keys: LiveKeyPort, now?: () => number): LiveDraftSource {
  const vault = createLiveDraftVault({ store, keys, ...(now ? { now } : {}) });
  return {
    async current(identity) {
      const draft = await vault.read(identity);
      return draft ? { revision: draft.revision, baseHeadSha: draft.baseHeadSha, liveTreeSha: draft.liveTreeSha, overlay: draft.overlay }
        : undefined;
    },
  };
}
