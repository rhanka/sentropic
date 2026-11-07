import type { KeyObject } from 'node:crypto';
import { candidateDigest, HandoffError, sealHandoff, verifyReceipt, type CandidateFile, type Handoff, type HandoffReceipt } from './handoff';
import { LiveError, type LiveAttempt, type LiveKey, type LiveRuntime } from './records';
import type { LivePorts } from './ports';

/** The remote host (D0) resolves its own admitted jobs and runs step 2 of the handoff (A-LIVE §8.4).
 * A host refusal rejects with HandoffError; any other rejection is a transport failure with an unknown outcome. */
export interface RemoteHost {
  job: LivePorts['publication']['job'];
  accept(key: LiveKey, handoff: Handoff, files: readonly CandidateFile[]): Promise<HandoffReceipt>;
}
/** Exact verified output snapshot read by the trusted supervisor after the build processes terminated. */
export interface CandidateExport { read(runtime: LiveRuntime, attempt: LiveAttempt): Promise<readonly CandidateFile[]> }
/** Builder-side durable job ledger: the intent is durable before the external effect; `record` keeps the first receipt. */
export interface HandoffOutcomes {
  intend(key: LiveKey, handoff: Handoff): Promise<void>;
  record(key: LiveKey, receipt: HandoffReceipt): Promise<HandoffReceipt>;
}
export function createHandoffPublication(options: {
  host: RemoteHost; candidates: CandidateExport; outcomes: HandoffOutcomes;
  signingKey(): KeyObject; hostKey(): KeyObject; now(): number; resends?: number;
}): LivePorts['publication'] {
  return {
    job: (key, jobId, fence) => options.host.job(key, jobId, fence),
    async commit(_unit, key, attempt, runtime) {
      if (!attempt.candidateDigest || !attempt.evidence) throw new LiveError('builder_unavailable', 'evidence_missing');
      const files = await options.candidates.read(runtime, attempt);
      // Anti-repack: only the exact verified candidate leaves the builder.
      if (candidateDigest(files) !== attempt.candidateDigest) throw new LiveError('builder_unavailable', 'candidate_mismatch');
      const handoff = sealHandoff({ scopeId: key.storageScopeId, artifactId: key.artifactId, jobId: attempt.id, kind: attempt.kind,
        runId: runtime.sessionId, attempt: attempt.leaseEpoch, generation: runtime.generation, commitSha: attempt.headSha,
        treeSha: attempt.treeSha, tuple: attempt.evidence, candidateDigest: attempt.candidateDigest,
        expectedReleaseId: attempt.expectedReleaseId }, options.signingKey(), options.now());
      await options.outcomes.intend(key, handoff);
      let receipt: HandoffReceipt | undefined;
      // The same signed handoff is resent; the host returns its stored receipt, never a second publication.
      for (let tries = 0; !receipt; tries++) {
        try { receipt = await options.host.accept(key, handoff, files); }
        catch (error) {
          if (error instanceof HandoffError) throw new LiveError('builder_unavailable', 'publication_refused');
          if (tries >= (options.resends ?? 2)) throw new LiveError('builder_unavailable', 'publication_indeterminate');
        }
      }
      try { verifyReceipt(receipt, options.hostKey(), handoff.claims); }
      catch { throw new LiveError('builder_unavailable', 'receipt_invalid'); }
      return { releaseId: (await options.outcomes.record(key, receipt)).releaseId };
    },
  };
}
