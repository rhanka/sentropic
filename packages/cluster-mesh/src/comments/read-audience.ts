import { CanonicalCommandError } from '@sentropic/comments';
import type { CanonicalChainRecord } from '@sentropic/comments';
export const assertCommentsReadAudience = (principal: string, record: CanonicalChainRecord): void => {
  if (
    (record.kind === 'lifecycle-event' && record.archiveKind === 'personal' && record.actor.principal !== principal) ||
    (record.kind === 'operation-audit-event' && !record.audience.includes(principal))
  )
    throw new CanonicalCommandError('denied', 'Comments record audience is unavailable');
};
