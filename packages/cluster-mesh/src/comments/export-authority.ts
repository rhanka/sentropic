import type { PgInstalledContext } from '../storage/postgres/installed-contracts.js';
import type { CommentsServiceOptions } from './lifecycle-contracts.js';
import type { CommentsExportState } from './boundary-codec.js';
import { readCommentsAuthorityTargets } from './authority-projection.js';
import { assertCommentsPgVisible } from './postgres-records.js';
import { chainIdentity } from './storage-schema.js';
import { authorizeComments } from './authority.js';
import { CommentsTransportError } from './transport-contracts.js';
export const authorizeCommentsExport = async (options: CommentsServiceOptions, context: PgInstalledContext, state: CommentsExportState): Promise<void> => {
  const captured = { ...context, root: state.root };
  for (const selection of state.selection.selections) {
    const chain = chainIdentity(selection).key; await assertCommentsPgVisible(context, chain);
    const targets = await readCommentsAuthorityTargets(captured, selection, state.manifest.heads[chain]!.head);
    if (!targets.length) throw new CommentsTransportError('incomplete', 'Retained export has no resource authority binding');
    await authorizeComments(options, context, 'read', targets);
  }
};
