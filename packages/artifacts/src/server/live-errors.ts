/** Closed G0/A-LIVE server errors; worker and driver text never crosses this registry. */
export const LIVE_FAILURE_STATUS = {
  git_live_revision_moved: 409, git_live_snapshot_mismatch: 409, git_live_no_changes: 422,
  git_live_conflict: 409, git_live_draft_conflict: 409, git_live_snapshot_expired: 409,
  git_live_draft_expired: 410, git_live_draft_unavailable: 503,
  dependency_integrity_missing: 422, dependency_integrity_mismatch: 422, dependency_cache_invalid: 422,
  git_not_attached: 422, git_binding_paused: 409, git_diverged: 409, builder_unavailable: 503,
  git_auto_publish_refused: 422, git_build_job_mismatch: 409, git_sha_not_on_branch: 422,
} as const;
export type LiveErrorCode = keyof typeof LIVE_FAILURE_STATUS;
export type LiveConflictReason = 'invalid_phase' | 'active_session' | 'pending_publication' |
  'commit_indeterminate' | 'stale_session' | 'stale_fence' | 'transition_busy';
