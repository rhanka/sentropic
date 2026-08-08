export interface DecisionSignatureValidation {
  authorized: boolean;
  reason?: string;
}

export interface DecisionValidator {
  validate(input: {
    workspace: string;
    decisionId: string;
    userId: string;
  }): Promise<DecisionSignatureValidation>;
}

// #503 L2 blocker-before-live: until the Track-decision authorization primitive
// (binds decisionId to the real DecisionDossierView + validates existence & signer
// authorization per the owner-ratified policy) is wired, signing is refused
// fail-closed. Replace this default with the real validator in the L2 follow-up.
export const failClosedDecisionValidator: DecisionValidator = {
  validate: async () => ({
    authorized: false,
    reason: 'decision-validation-not-configured',
  }),
};
