// T5-C5 review side (r6 §4.2, WR5-06): native-review requirement classification and
// the automated-translation attestation contract. An Actions-bot self-approval or an
// attestor equal to the PR author fails; a verified independent receipt translated
// by a distinct principal is accepted only for automation-permitted requirements,
// with the event disclosing the translation and binding the exact receipt digest; a
// person-owned token never satisfies a human-intent or unknown requirement.

export const AUTOMATED_TRANSLATION_PREFIX = 'Automated translation of independent model review';

export function classifyNativeReviewRequirement({ requiresReview, automationPermitted, humanIntent }) {
  if (!requiresReview) return 'none';
  if (humanIntent) return 'human-intent';
  if (automationPermitted) return 'automation-permitted';
  return 'unknown';
}

// The attestation event must be a disclosed automated translation by a principal
// distinct from the PR author, bound to the exact independent receipt (uri + sha256),
// patch digest and exact H/B/T, unexpired, with a reviewer model independent of the
// contributing models and no human-review intent on the receipt.
export function assertAttestationEvent({ event, receipt, pr, patchDigest, nowMs }) {
  if (event.actor === 'github-actions[bot]' || event.actor === pr.author || receipt.attestorActor === pr.author) {
    throw new Error('self-approval-refused:' + event.actor);
  }
  if (event.actor !== receipt.attestorActor) throw new Error('attestor-mismatch:' + event.actor);
  if (!event.body.startsWith(AUTOMATED_TRANSLATION_PREFIX)) throw new Error('undisclosed-automation');
  const uri = /receipt:\s*(\S+)/.exec(event.body)?.[1];
  const sha = /sha256=([0-9a-f]{64})/.exec(event.body)?.[1];
  if (uri !== receipt.uri || sha !== receipt.sha256) throw new Error('receipt-mismatch');
  if (/humanReviewIntent=true/.test(event.body) || receipt.humanReviewIntent) throw new Error('human-intent-flag');
  if (receipt.normalizedPatchDigest !== patchDigest) throw new Error('patch-mismatch');
  if (receipt.repo !== pr.repo || receipt.pr !== pr.number || receipt.head !== pr.head || receipt.base !== pr.base || receipt.tree !== pr.tree) {
    throw new Error('hbt-mismatch');
  }
  if (receipt.expiresAt <= nowMs) throw new Error('receipt-expired');
  if (receipt.contributorModels.includes(receipt.reviewerModel)) throw new Error('reviewer-not-independent:' + receipt.reviewerModel);
}

// A person-owned token never satisfies a human-intent or unknown requirement, even
// when GitHub's approval count passes. Automated (non-person) tokens are not
// human-intent evidence either; they are only admissible for automation-permitted
// requirements, which the attestation event above must prove separately.
export function assertPersonTokenApproval({ requirement, tokenOwnerIsPerson, approvalCount }) {
  if (tokenOwnerIsPerson && (requirement === 'human-intent' || requirement === 'unknown')) {
    throw new Error('human-intent-not-satisfied-by-token:' + requirement + ':' + approvalCount);
  }
}
