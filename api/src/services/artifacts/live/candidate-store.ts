import { candidateDigest, type CandidateFile } from '@sentropic/artifacts/live-host';
import { LiveError, type LiveAttempt, type LiveRuntime } from './records';
import type { CandidateExport } from './handoff-publication';

/** Trusted in-API holder of the sealed candidate, between the supervisor's stable snapshot (W3
 * `SupervisorSources.candidate`) and the SG4b upload (`CandidateExport`). One entry per pod: a newer candidate for the
 * same binding replaces the older one. Run, lease, attempt and the single live-host digest are rechecked on both sides. */
export function createCandidateStore() {
  const held = new Map<string, { fence: string; digest: string; files: readonly CandidateFile[] }>();
  const fence = (runtime: LiveRuntime, attempt: LiveAttempt) => JSON.stringify([runtime.sessionId, runtime.leaseEpoch, attempt.id]);
  return {
    async candidate(input: { runtime: LiveRuntime; attempt: LiveAttempt; candidateDigest: string; files: readonly CandidateFile[] }) {
      if (candidateDigest(input.files) !== input.candidateDigest) throw new LiveError('builder_unavailable', 'candidate_mismatch');
      held.set(input.runtime.podName, { fence: fence(input.runtime, input.attempt), digest: input.candidateDigest,
        files: input.files.map(file => ({ path: file.path, bytes: file.bytes })) });
    },
    async read(runtime: LiveRuntime, attempt: LiveAttempt) {
      const entry = held.get(runtime.podName);
      if (!entry || entry.fence !== fence(runtime, attempt) || entry.digest !== attempt.candidateDigest) {
        throw new LiveError('builder_unavailable', 'candidate_missing');
      }
      return entry.files;
    },
  } satisfies CandidateExport & Record<string, unknown>;
}
