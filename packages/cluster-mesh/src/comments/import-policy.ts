import { canonicalJson } from '@sentropic/comments';
import type { PgStagedModule } from '../storage/postgres/staged-module.js';
import { decodePgText } from '../storage/postgres/codec.js';
import type { CommentsServiceOptions } from './lifecycle-contracts.js';
import { assertCommentsAuthority } from './authority.js';
import { commentsControlAddress, readCommentsAcknowledgement, readCommentsImport } from './import-control.js';
import { CommentsTransportError } from './transport-contracts.js';
export const commentsImportPolicy = (options: CommentsServiceOptions): PgStagedModule => ({
  authorize: async (input, context) => {
    const { schema, scope } = commentsControlAddress(context);
    const result = await context.session.execute({ text: `SELECT operation_id FROM ${schema}.comments_preparations WHERE scope_key=$1 AND kernel_operation=$2`, values: [scope, input.begin.operationKey] });
    const state = result.rows[0] ? await readCommentsImport(context, decodePgText(result.rows[0].operation_id)) : null;
    if (!state || canonicalJson(state.begin) !== canonicalJson(input.begin) || (state.unit && state.unit.unitId !== input.unitId)) throw new CommentsTransportError('denied', 'Installed import binding is unavailable');
    for (const capability of state.binding.capabilities) await assertCommentsAuthority(options, context.grant, capability, state.binding.targets);
    if (input.phase === 'fragment') {
      const ack = input.fragment && await readCommentsAcknowledgement(context, state.binding.operationId, input.fragment.ordinal);
      if (!ack || ack.kernelDigest !== input.fragment?.digest) throw new CommentsTransportError('denied', 'Fragment was not prepared by the comments module');
    }
    if ((input.phase === 'seal' || input.phase === 'commit') && (!state.root || canonicalJson(state.root) !== canonicalJson(input.root))) throw new CommentsTransportError('incomplete', 'Complete terminal import root is required');
  },
  policy: async (input) => {
    if (input.purges !== 0) throw new CommentsTransportError('denied', 'Historical import cannot execute a physical purge');
  },
});
