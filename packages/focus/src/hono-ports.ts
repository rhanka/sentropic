import type { Context } from "hono";

import type {
  AuthenticatedOwnPrincipal,
  DecisionDossierDocument,
  FocusLiveSession,
  TrackNativeDecisionTarget,
} from "./model.js";
import type { TrackOwnerSignaturePort } from "./live/index.js";

export interface FocusHttpPrincipal {
  readonly userId: string;
  readonly sessionId: string;
  readonly authenticatedAt: string;
  readonly workspaceId: string;
  readonly email?: string | null;
  readonly role?: string;
}

export interface FocusDecisionValidatorPort {
  validate(input: {
    readonly workspace: string;
    readonly decisionId: string;
    readonly userId: string;
    readonly userEmail?: string | null;
  }): Promise<{ readonly authorized: boolean; readonly reason?: string }>;
}

export type FocusTrackReadResult =
  | { readonly status: "found"; readonly document: DecisionDossierDocument }
  | { readonly status: "not-found" }
  | { readonly status: "unavailable" };

export interface FocusTrackPort {
  readDecision(target: TrackNativeDecisionTarget): Promise<FocusTrackReadResult>;
  getOwnerSignaturePort(): Promise<TrackOwnerSignaturePort | undefined>;
}

export interface FocusTenancyPort {
  authorize(input: {
    readonly principal: FocusHttpPrincipal;
    readonly owner?: AuthenticatedOwnPrincipal;
    readonly target: TrackNativeDecisionTarget;
    readonly action: "read" | "sign";
  }): Promise<boolean>;
}

export interface FocusOwnerSignaturePort {
  createSession(input: {
    readonly principal: FocusHttpPrincipal;
    readonly track: TrackOwnerSignaturePort;
    readonly authorize: (
      owner: AuthenticatedOwnPrincipal,
      target: TrackNativeDecisionTarget,
    ) => Promise<boolean>;
  }): FocusLiveSession;
}

export interface CreateFocusRouterOptions {
  readonly resolvePrincipal: (context: Context) => FocusHttpPrincipal | undefined | Promise<FocusHttpPrincipal | undefined>;
  readonly decisionValidator: FocusDecisionValidatorPort;
  readonly ownerSignature: FocusOwnerSignaturePort;
  readonly track: FocusTrackPort;
  readonly tenancy: FocusTenancyPort;
}
