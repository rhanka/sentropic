import { candidateDigest, type CandidateFile } from './candidate.js';
import { LiveHostError } from './errors.js';
import {
  HANDOFF_LIFETIME_MS, handoffAuthentic, handoffEvidence, jobKey, signReceipt, type Handoff, type HandoffClaims, type HandoffReceipt,
} from './handoff.js';
import { assertSigner, type KeyResolver, type SigningKey } from './keys.js';
import { publicationRecheck, type HostRecheckView } from './recheck.js';

/** Host persistence. `transaction` runs `work` and stores its receipt under the job key in ONE host transaction, so a
 * failed recheck, release CAS or bytes re-read rolls back the consumption too. A concurrent winner is returned as stored. */
export interface HostLedger {
  find(jobKey: string): Promise<HandoffReceipt | undefined>;
  transaction(jobKey: string, work: () => Promise<HandoffReceipt>): Promise<HandoffReceipt>;
}
export interface AcceptOptions {
  /** Authenticated host scope. */
  scopeId: string;
  /** Builder public keys by kid: old and new during a rotation overlap. */
  builderKeys: KeyResolver;
  /** Current host receipt key; its kid is stamped on the receipt. */
  receiptKey: SigningKey;
  now(): number;
  ledger: HostLedger;
  /** Inside the host transaction, before any write: the locked durable state `publicationRecheck` evaluates. */
  view(claims: HandoffClaims): HostRecheckView | Promise<HostRecheckView>;
  /** Inside the host transaction: store the exact bytes, write release/index/receipt/baseline, re-read stored bytes. */
  publish(claims: HandoffClaims, files: readonly CandidateFile[]): Promise<{ releaseId: string; manifestDigest: string; storedDigest: string }>;
}

/** A-LIVE §8.4 step 2. Refuses with a closed LiveHostError code; a retry after committed success returns the stored receipt. */
export async function acceptHandoff(options: AcceptOptions, handoff: Handoff, files: readonly CandidateFile[]): Promise<HandoffReceipt> {
  assertSigner(options.receiptKey);
  if (!handoffAuthentic(handoff, options.builderKeys)) throw new LiveHostError('handoff_unauthenticated');
  const { claims } = handoff;
  if (!handoffEvidence(claims)) throw new LiveHostError('handoff_evidence_missing');
  const job = jobKey(claims);
  const stored = await options.ledger.find(job);
  if (stored) { if (stored.nonce !== claims.nonce) throw new LiveHostError('handoff_replayed'); return stored; }
  const now = options.now();
  if (now >= claims.expiresAt || claims.expiresAt - claims.sealedAt > HANDOFF_LIFETIME_MS) throw new LiveHostError('handoff_expired');
  if (claims.scopeId !== options.scopeId) throw new LiveHostError('handoff_mismatch', 'scope_mismatch');
  if (candidateDigest(files) !== claims.candidateDigest) throw new LiveHostError('candidate_bytes_mismatch');
  const receipt = await options.ledger.transaction(job, async () => {
    const refusal = publicationRecheck(await options.view(claims), claims);
    if (refusal) throw new LiveHostError('handoff_mismatch', refusal);
    const published = await options.publish(claims, files);
    if (published.storedDigest !== claims.candidateDigest) throw new LiveHostError('candidate_bytes_mismatch');
    return signReceipt({ v: 1, kid: options.receiptKey.kid, nonce: claims.nonce, scopeId: claims.scopeId,
      artifactId: claims.artifactId, jobId: claims.jobId, runId: claims.runId, attempt: claims.attempt, commitSha: claims.commitSha,
      candidateDigest: claims.candidateDigest, releaseId: published.releaseId, manifestDigest: published.manifestDigest,
      committedAt: options.now() }, options.receiptKey);
  });
  if (receipt.nonce !== claims.nonce) throw new LiveHostError('handoff_replayed');
  return receipt;
}
