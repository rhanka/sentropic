export type RetainedChannel = 'terminal.cache' | 'native.mirror';
export type Channel = RetainedChannel | 'terminal.live' | 'keyboard.control';
export type Retention = { mode: 'none' } | { mode: 'duration'; durationSeconds: number };
export interface ContentScope {
  ownerId: string;
  workspaceId: string;
  projectId: string;
  sourceId: string;
}
export interface NamedHistory {
  provider: string;
  conversationId: string;
  lineage: string;
  checkpoint: string;
  inventoryDigest: string;
  sourceId: string;
}
export interface ProjectOffer extends ContentScope {
  expectedRevision: number;
  channels: Record<Channel, boolean>;
  futureSessions: boolean;
  selectedSessionIds: string[];
  namedHistories: NamedHistory[];
  retentionByChannel: Record<RetainedChannel, Retention>;
  offlineReadAccepted: boolean;
}
export const createOffer = (scope: ContentScope): ProjectOffer => ({
  ...scope, expectedRevision: 0,
  channels: { 'terminal.live': false, 'terminal.cache': false, 'native.mirror': false, 'keyboard.control': false },
  futureSessions: false, selectedSessionIds: [], namedHistories: [],
  retentionByChannel: { 'terminal.cache': { mode: 'none' }, 'native.mirror': { mode: 'none' } },
  offlineReadAccepted: false,
});

export function retentionChoice(
  mode: Retention['mode'], value = 1, unit: 'hours' | 'days' = 'days',
): Retention {
  if (mode === 'none') return { mode: 'none' };
  const durationSeconds = value * (unit === 'hours' ? 3600 : 86400);
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds <= 0
    || !Number.isSafeInteger(durationSeconds * 1000)) throw new Error('invalid_retention');
  return { mode: 'duration', durationSeconds };
}

export interface SessionView extends ContentScope {
  bindingId?: string;
  sessionId?: string;
  status: 'attached' | 'detached' | 'ended';
  sourceAvailable: boolean;
  liveAuthorized: boolean;
  storedAuthorized: boolean;
  historyAuthorized: boolean;
  retained: boolean;
  excluded: boolean;
  membershipActive?: boolean;
  revoked?: boolean;
  purgeStatus?: 'pending' | 'running' | 'completed' | 'failed';
  projectRevision: number;
  grantProjectRevision: number;
  expiresAt: number | null;
  pauseReason?: string;
  lastReceivedAt?: number;
  gaps?: { from: number; to: number; reason: string }[];
}

export function viewAccess(row: SessionView, scope: ContentScope, now = Date.now()) {
  const denied = (reason: string) => ({ live: false, stored: false, reason });
  if (Object.keys(scope).some((key) => row[key as keyof ContentScope] !== scope[key as keyof ContentScope])) {
    return denied('scope_mismatch');
  }
  if (row.excluded) return denied('session_excluded');
  if (row.membershipActive === false) return denied('membership_required');
  if (row.revoked) return denied('grant_revoked');
  if (row.purgeStatus) return denied(`purge_${row.purgeStatus}`);
  const closed = row.status !== 'attached';
  const stored = row.retained && row.storedAuthorized && (!closed || row.historyAuthorized)
    && (row.expiresAt === null || now < row.expiresAt);
  const reason = closed ? (row.historyAuthorized ? 'retained_closed' : 'history_authorization_required')
    : row.projectRevision !== row.grantProjectRevision ? 'project_revision_changed'
      : row.pauseReason || (!row.sourceAvailable ? 'source_unavailable' : '');
  return { live: !closed && !reason && row.liveAuthorized, stored, reason };
}
