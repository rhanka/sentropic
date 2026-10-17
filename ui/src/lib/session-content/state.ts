import { matchesConfirmation, proofExpiry, type ConfirmationProof, type ControlContext, type PreparedProof } from './proof';

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
}
export const createOffer = (scope: ContentScope): ProjectOffer => ({
  ownerId: scope.ownerId, workspaceId: scope.workspaceId, projectId: scope.projectId,
  sourceId: scope.sourceId, expectedRevision: 0,
  channels: { 'terminal.live': false, 'terminal.cache': false, 'native.mirror': false, 'keyboard.control': false },
  futureSessions: false, selectedSessionIds: [], namedHistories: [],
  retentionByChannel: { 'terminal.cache': { mode: 'none' }, 'native.mirror': { mode: 'none' } },
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
  expiresAt?: number | null;
  copies?: { objectId: string; channel: RetainedChannel; expiresAt: number | null }[];
  pauseReason?: string;
  lastReceivedAt?: number;
  gaps?: { from: number; to: number; reason: string }[];
}

export function viewAccess(row: SessionView, scope: ContentScope, now = Date.now()) {
  const denied = (reason: string) => ({ live: false, stored: false, reason });
  if ((['ownerId', 'workspaceId', 'projectId', 'sourceId'] as const).some((key) => row[key] !== scope[key])) {
    return denied('scope_mismatch');
  }
  if (row.membershipActive === false) return denied('membership_required');
  if (row.revoked) return denied('grant_revoked');
  if (row.purgeStatus) return denied(`purge_${row.purgeStatus}`);
  const closed = row.status !== 'attached';
  const deadlineAllows = row.expiresAt === undefined
    ? row.copies?.some((copy) => copy.expiresAt === null || now < copy.expiresAt) ?? false
    : row.expiresAt === null || now < row.expiresAt;
  const stored = row.retained && row.storedAuthorized && (!closed || row.historyAuthorized) && deadlineAllows;
  const reason = row.excluded ? 'session_excluded' : closed ? (row.historyAuthorized ? 'retained_closed' : 'history_authorization_required')
    : row.projectRevision !== row.grantProjectRevision ? 'project_revision_changed'
      : row.pauseReason || (!row.sourceAvailable ? 'source_unavailable' : '');
  return { live: !row.excluded && !closed && !reason && row.liveAuthorized, stored, reason };
}

export function canRequestHistory(row: SessionView, scope: ContentScope, now = Date.now()): boolean {
  const copyAvailable = row.expiresAt === undefined
    ? row.copies?.some((copy) => copy.expiresAt === null || now < copy.expiresAt) ?? false
    : row.expiresAt === null || now < row.expiresAt;
  return row.retained && !row.historyAuthorized && copyAvailable
    && !row.revoked && !row.purgeStatus && row.membershipActive !== false
    && viewAccess(row, scope, now).reason !== 'scope_mismatch';
}

export function keyboardContext(row: SessionView, scope: ContentScope, control: ControlContext | undefined,
  sourceVerified: boolean): ControlContext | null {
  if (!sourceVerified || !control || !viewAccess(row, scope).live
    || control.ownerId !== scope.ownerId || control.workspaceId !== scope.workspaceId
    || control.bindingId !== row.bindingId || control.projectRevision !== row.projectRevision) return null;
  return control;
}

interface ConsentPorts<P extends PreparedProof> {
  prepare: (offer: ProjectOffer) => Promise<P>;
  accept: (offer: ProjectOffer, prepared: P, confirmation: ConfirmationProof) => Promise<unknown>;
  prove: (prepared: P, signal: AbortSignal) => Promise<ConfirmationProof>;
  available: () => boolean;
}

/** Transient only. Neither drafts nor proofs survive edits, logout or navigation. */
export class ConsentFlow<P extends PreparedProof = PreparedProof> {
  offer: ProjectOffer;
  prepared: P | null = null;
  accepted = false;
  confirmation: ConfirmationProof | null = null;
  status: 'idle' | 'step_up_required' | 'confirmation_returned' | 'confirmation_refused' | 'outcome_unknown' = 'idle';
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
    this.prepared = null; this.confirmation = null; this.status = 'idle';
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

  async authenticate() {
    const prepared = this.prepared;
    if (!prepared || this.pending || !this.ports.available() || this.fingerprint !== JSON.stringify(this.offer)) return;
    if (proofExpiry(prepared) <= Date.now() || proofExpiry(prepared) - prepared.native.challenge.issuedAt > 60000
      || !['share', 'amend'].includes(prepared.native.challenge.purpose)
      || prepared.native.challenge.target.kind !== 'policy') { this.cancel(); return; }
    const revision = this.revision; this.pending = true; this.status = 'step_up_required';
    try {
      const confirmation = await this.ports.prove(prepared, this.abort.signal);
      if (revision !== this.revision || !this.ports.available() || this.fingerprint !== JSON.stringify(this.offer)) return;
      if (proofExpiry(prepared) <= Date.now() || !matchesConfirmation(prepared, confirmation)) throw new Error('confirmation_refused');
      this.confirmation = confirmation; this.status = 'confirmation_returned';
    } catch (error) {
      if (revision === this.revision) { this.prepared = null; this.confirmation = null; this.status = 'confirmation_refused'; }
      throw error;
    } finally { if (revision === this.revision) this.pending = false; }
  }

  async confirm() {
    const prepared = this.prepared; const confirmation = this.confirmation;
    if (!prepared || !confirmation || this.pending || !this.ports.available()
      || this.fingerprint !== JSON.stringify(this.offer) || !Object.values(this.offer.channels).some(Boolean)) return;
    if (proofExpiry(prepared) <= Date.now()) { this.cancel(); return; }
    this.pending = true; this.prepared = null; this.confirmation = null; this.status = 'outcome_unknown';
    const revision = this.revision; const offer = structuredClone(this.offer);
    try {
      await this.ports.accept(offer, prepared, confirmation);
      if (revision === this.revision) { this.accepted = true; this.status = 'idle'; }
    } finally { if (revision === this.revision) this.pending = false; }
  }
}
