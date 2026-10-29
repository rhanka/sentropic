import type * as ObjectLocks from '$lib/utils/object-lock';
import type { StreamHubClient } from '@sentropic/chat-ui/client/streamTypes';

// Host preparation boundary. Published CL-1M imports/type conformance are gated in H3.
export interface Actor { actorId: string; kind: 'human' | 'agent' | 'nhi'; displayLabel: string; color: string }
export interface Unit { scopeRef: string; unitRef?: string }
export interface LockState { unit: Unit; holder: Actor | null; expiresAt: string | null; unlockRequestedBy?: Actor | null }
export interface PresenceState { scopeRef: string; actors: readonly Actor[]; total: number }
export interface ProviderOptions {
  scopeRef: string; objectType: ObjectLocks.LockObjectType; objectId: string; currentActorId: string;
  locks: typeof ObjectLocks; stream: Pick<StreamHubClient, 'set' | 'delete'>; onError(error: unknown): void;
}
export function createCanvasProvider(_options: ProviderOptions): {
  acquireLock(unit: Unit): Promise<{ acquired: boolean; lock: LockState }>;
  refreshLock(unit: Unit): Promise<LockState>;
  releaseLock(unit: Unit): Promise<void>;
  requestUnlock(unit: Unit): Promise<LockState>;
  acceptUnlock(unit: Unit): Promise<LockState>;
  forceUnlock(unit: Unit): Promise<void>;
  recordPresence(scopeRef: string): Promise<PresenceState>;
  leavePresence(scopeRef: string): Promise<void>;
  subscribeLock(unit: Unit, callback: (state: LockState) => void): () => void;
  subscribePresence(scopeRef: string, callback: (state: PresenceState) => void): () => void;
} { throw new Error('H1 provider not implemented'); }
export function canvasEditable(_input: { mode: 'controlled' | 'live'; canEdit: boolean; admitted: boolean; currentActorId: string; lock: LockState }): boolean { throw new Error('H1 edit posture not implemented'); }
