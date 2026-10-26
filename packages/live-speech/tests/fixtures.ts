import { vi } from 'vitest';
import { SpeechCoordinator, createSession } from '../src/core/session.js';
import type { Journal, SessionState, ControlPort, TrustedAuthority } from '../src/core/session.js';

export const scope = {
  speechSessionId: 'speech-1', tenantId: 'tenant-1', principalId: 'owner-1',
  targetSessionId: 'agent-1', sourceGeneration: 'source-1', controllerEpoch: 1, consentRevision: 'consent-1',
};

/** Simulates atomic durable transactions, rollback and restart from committed bytes. */
export class TestJournal implements Journal {
  state: SessionState;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(state = createSession(scope, { read: 'read-only', exec: 'mutating', delegate: 'unclassified' },
    ['read', 'exec', 'delegate'], ['status'])) { this.state = structuredClone(state); }
  transact<T>(change: (draft: SessionState) => T): Promise<T> {
    const work = this.tail.then(() => {
      const draft = structuredClone(this.state);
      const result = change(draft);
      this.state = structuredClone(draft);
      return structuredClone(result);
    });
    this.tail = work.catch(() => undefined);
    return work;
  }
  restart() { return new TestJournal(JSON.parse(JSON.stringify(this.state)) as SessionState); }
}

export const fixture = (journal = new TestJournal()) => {
  const control: ControlPort = {
    start: vi.fn(async () => ({ nativeTurnId: 'native-1' })),
    interrupt: vi.fn(async () => undefined),
    query: vi.fn(async () => ({ status: 'unknown' as const })),
  };
  const authority: TrustedAuthority = {
    verifyRisk: vi.fn(async () => ({ principalId: scope.principalId, tenantId: scope.tenantId, method: 'typed' as const })),
    verifyMutation: vi.fn(async (request) => ({ ...request,
      authorizationId: `auth:${request.actionId}`, principalId: scope.principalId, tenantId: scope.tenantId })),
  };
  const stopPlayback = vi.fn();
  const core = new SpeechCoordinator(journal, control, authority, stopPlayback, () => 100);
  return { core, journal, control, authority, stopPlayback };
};

export const commit = (core: SpeechCoordinator, utteranceId = 'utterance-1') =>
  core.commit({ scope, utteranceId, inputRef: `final:${utteranceId}` });

export const mutation = (callId = 'call-1') => ({
  callId, actionId: `action:${callId}`, effectId: `effect:${callId}`, toolClass: 'exec',
  toolName: 'write', argumentsDigest: 'sha256:arguments', operation: 'Write fixture', proof: 'fresh-approval',
});
