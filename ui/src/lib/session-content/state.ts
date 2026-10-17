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
  ownerId: scope.ownerId, workspaceId: scope.workspaceId, projectId: scope.projectId,
  sourceId: scope.sourceId, expectedRevision: 0,
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
  if ((['ownerId', 'workspaceId', 'projectId', 'sourceId'] as const).some((key) => row[key] !== scope[key])) {
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

interface ConsentPorts<P> {
  prepare: (offer: ProjectOffer) => Promise<P>;
  accept: (offer: ProjectOffer, prepared: P, assertion: unknown) => Promise<unknown>;
  prove: (prepared: P, signal: AbortSignal) => Promise<unknown>;
  available: () => boolean;
}

/** Transient only. Neither drafts nor proofs survive edits, logout or navigation. */
export class ConsentFlow<P = unknown> {
  offer: ProjectOffer;
  prepared: P | null = null;
  accepted = false;
  private revision = 0;
  private fingerprint = '';
  private pending = false;
  private abort = new AbortController();

  constructor(offer: ProjectOffer, private readonly ports: ConsentPorts<P>) {
    this.offer = structuredClone(offer);
  }

  edit(offer: ProjectOffer) {
    this.cancel();
    this.offer = structuredClone(offer);
  }

  cancel() {
    this.revision++;
    this.abort.abort();
    this.abort = new AbortController();
    this.prepared = null;
    this.fingerprint = '';
    this.accepted = false;
    this.pending = false;
  }

  async prepare() {
    if (this.pending || !this.ports.available()) return;
    this.cancel();
    this.pending = true;
    const revision = this.revision;
    const offer = structuredClone(this.offer);
    const fingerprint = JSON.stringify(offer);
    try {
      const prepared = await this.ports.prepare(offer);
      if (revision === this.revision && fingerprint === JSON.stringify(this.offer)) {
        this.prepared = prepared;
        this.fingerprint = fingerprint;
      }
    } finally {
      if (revision === this.revision) this.pending = false;
    }
  }

  async confirm() {
    const prepared = this.prepared;
    if (!prepared || this.pending || !this.ports.available()
      || this.fingerprint !== JSON.stringify(this.offer)
      || !this.offer.offlineReadAccepted || !Object.values(this.offer.channels).some(Boolean)) return;
    const expiresAt = (prepared as { expiresAt?: number }).expiresAt;
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt!) { this.cancel(); return; }
    this.pending = true;
    const revision = this.revision;
    const offer = structuredClone(this.offer);
    try {
      const assertion = await this.ports.prove(prepared, this.abort.signal);
      if (revision !== this.revision || !this.ports.available()
        || this.fingerprint !== JSON.stringify(this.offer) || Date.now() >= expiresAt!) return;
      this.prepared = null;
      await this.ports.accept(offer, prepared, assertion);
      if (revision === this.revision) this.accepted = true;
    } finally {
      if (revision === this.revision) { this.pending = false; this.prepared = null; }
    }
  }
}
