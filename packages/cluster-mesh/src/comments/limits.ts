import { UnsupportedProfileError } from '../storage/errors.js';
import type { WorkLimits } from '../storage/contracts.js';
// Wire payload bytes are encoded twice in generic immutable-record and chain
// effects. This backend budget includes their JSON escaping and metadata.
export const COMMENTS_STORAGE_LIMITS: WorkLimits = Object.freeze({
  maxRecords: 1024,
  maxAppends: 128,
  maxEncodedBytes: 4194304,
});
export const requireCommentsStorageLimits = (limits: WorkLimits = COMMENTS_STORAGE_LIMITS): WorkLimits => {
  if (
    (Object.keys(COMMENTS_STORAGE_LIMITS) as (keyof WorkLimits)[]).some(
      (key) => limits[key] < COMMENTS_STORAGE_LIMITS[key],
    )
  )
    throw new UnsupportedProfileError('comments-transport-capacity-v1');
  return limits;
};
