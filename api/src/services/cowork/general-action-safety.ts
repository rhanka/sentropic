/** General Cowork's D2 boundary: this data can be displayed, never authorize. */
const assertedUntrusted = Symbol('ASSERTED_UNTRUSTED');
export type AssertedUntrusted<T> = Readonly<{ readonly [assertedUntrusted]: true; readonly value: T }>;

export function quarantineModelInput<T>(value: T): AssertedUntrusted<T> {
  return Object.freeze({ [assertedUntrusted]: true, value }) as AssertedUntrusted<T>;
}

export type GeneralActionClass =
  | 'observation' | 'navigation' | 'enter' | 'submit' | 'purchase' | 'delete'
  | 'share' | 'permission' | 'legal' | 'upload' | 'download' | 'messaging'
  | 'credential' | 'external-mutation' | 'unknown';

export type ImmutableActionDescriptor = Readonly<{
  id: string;
  version: string;
  actionClass: GeneralActionClass;
  argumentDigest: string;
}>;

export type HumanSelectedTarget = Readonly<{
  deviceId: string;
  selectedAt: Date;
  source: 'human-controller';
  isolatedVmTarget: boolean;
  egressPolicyRef: string | null;
}>;

export type FoundationAuthorityDecision =
  | { outcome: 'PAS-FAIT'; reason: 'human_target_required' | 'containment_required' | 'human_receipt_required' | 'signed_pep_required' | 'native_pep_unavailable' }
  | { outcome: 'DÉPOSÉ-EN-ATTENTE'; reason: 'durable_review_required' };

const D5_CLASSES = new Set<GeneralActionClass>([
  'enter', 'submit', 'purchase', 'delete', 'share', 'permission', 'legal',
  'upload', 'download', 'messaging', 'credential', 'external-mutation', 'unknown',
]);

export function requiresFreshHumanReceipt(actionClass: GeneralActionClass): boolean {
  return D5_CLASSES.has(actionClass);
}

/**
 * This is intentionally unable to return FAIT or an auto-authorized decision.
 * Lots 3/4 provide signed PEP verification and fresh trusted receipts.
 */
export function decideFoundationAuthority(input: {
  descriptor: ImmutableActionDescriptor;
  target: HumanSelectedTarget | null;
  freshHumanReceiptId: string | null;
  signedPepDistributionVerified: boolean;
  nodeEnv?: string;
}): FoundationAuthorityDecision {
  if (!input.target || input.target.source !== 'human-controller') return { outcome: 'PAS-FAIT', reason: 'human_target_required' };
  if (input.nodeEnv === 'production' || !input.target.isolatedVmTarget || !input.target.egressPolicyRef) {
    return { outcome: 'PAS-FAIT', reason: 'containment_required' };
  }
  if (requiresFreshHumanReceipt(input.descriptor.actionClass) && !input.freshHumanReceiptId) {
    return { outcome: 'PAS-FAIT', reason: 'human_receipt_required' };
  }
  if (!input.signedPepDistributionVerified) return { outcome: 'PAS-FAIT', reason: 'signed_pep_required' };
  // A verified distributor is necessary, never sufficient. Native PEP execution
  // is deliberately absent in this foundation, so automatic execution is unreachable.
  return { outcome: 'DÉPOSÉ-EN-ATTENTE', reason: 'durable_review_required' };
}
