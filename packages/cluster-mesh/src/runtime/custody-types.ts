import type {
  VerifiedCustodyRef,
  VerifiedInvocationContext,
  VerifiedInvocationContextRequest,
} from '@sentropic/contracts';

export type CustodyAction = 'drive' | 'wake' | 'relaunch';

export interface CustodyIssueRequest {
  readonly registrationId: string;
  readonly action: CustodyAction;
  readonly holderPrincipalId: string;
  readonly invocationId: string;
  readonly requestedTtlSeconds?: number;
}

export interface CustodyTokenIssuer {
  readonly issuerId: string;
  readonly keyId: string;
  readonly algorithm: 'EdDSA';
  readonly curve: 'Ed25519';
}

export interface SignedCustodyToken {
  readonly kind: 'signed-custody-token';
  readonly version: 'sentropic.cluster-mesh.custody/v1';
  readonly tokenId: string;
  readonly issuer: CustodyTokenIssuer;
  readonly audience: string;
  readonly registrationId: string;
  readonly action: CustodyAction;
  readonly holderPrincipalId: string;
  readonly epoch: number;
  readonly custodyId: string;
  readonly invocationId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly evidence: {
    readonly kind: 'detached-signature';
    readonly canonicalization: 'sentropic-json-v1';
    readonly signatureBase64Url: string;
  };
}

export type CustodyRevocationSelector =
  | { readonly kind: 'token'; readonly tokenId: string }
  | {
      readonly kind: 'binding';
      readonly registrationId: string;
      readonly custodyId: string;
      readonly holderPrincipalId: string;
      readonly epoch: number;
    }
  | { readonly kind: 'holder'; readonly holderPrincipalId: string };

export interface CustodyRevocationReceipt {
  readonly issuerId: string;
  readonly selector: CustodyRevocationSelector;
  readonly reason: string;
  readonly revokedAt: string;
}

export interface CustodySource {
  readonly issuerId: string;
  issue(input: CustodyIssueRequest): Promise<SignedCustodyToken | null>;
  revoke(input: {
    readonly selector: CustodyRevocationSelector;
    readonly reason: string;
  }): Promise<CustodyRevocationReceipt>;
}

export interface CustodyTokenExpectation {
  readonly audience: string;
  readonly registrationId: string;
  readonly action: CustodyAction;
  readonly holderPrincipalId: string;
  readonly epoch: number;
  readonly custodyId: string;
  readonly invocationId: string;
}

export type CustodyTokenDecision =
  | { readonly ok: true; readonly token: SignedCustodyToken }
  | {
      readonly ok: false;
      readonly reason: 'untrusted' | 'unbound' | 'stale' | 'revoked' | 'replayed' | 'unavailable';
    };

export interface CustodyTokenVerifierPort {
  verify(
    token: SignedCustodyToken,
    expected: CustodyTokenExpectation,
  ): Promise<CustodyTokenDecision>;
  consume(
    token: SignedCustodyToken,
    expected: CustodyTokenExpectation,
  ): Promise<CustodyTokenDecision>;
}

export interface SourceVerifiedCustodyRef extends VerifiedCustodyRef {
  readonly sourceToken: SignedCustodyToken;
}

export type CustodyVerifiedInvocationContext = VerifiedInvocationContext & {
  readonly custody: SourceVerifiedCustodyRef;
};

export interface CustodyInvocationContextRequest extends VerifiedInvocationContextRequest {
  readonly custodyToken?: string;
  readonly custodyAction?: CustodyAction;
}

export interface CustodyBinding {
  readonly registrationId: string;
  readonly custodyId: string;
  readonly holderPrincipalId: string;
  readonly epoch: number;
  readonly meshDomain: string;
  readonly status: 'active' | 'revoked';
  readonly expiresAt: string;
}

export interface CustodyTrustRoot {
  resolve(issuer: CustodyTokenIssuer):
    Promise<{ readonly publicKeyBase64Url: string } | null>;
}

export interface CustodySigningPort {
  signCanonical(payload: Uint8Array): Promise<string>;
}
