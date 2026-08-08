/**
 * Focus document model — the CONCRETE decision-dossier specialization (Focus-M1 L1).
 *
 * Per SPEC_VOL_FOCUS §3: a Focus is a renderable + interactive document over track data.
 * This file models the `DecisionDossierDocument` — the FIRST focus TYPE (a FocusDocument
 * whose primary outcome modality is a decision). It is intentionally CONCRETE, not a generic
 * "Focus platform": the model stays decision-dossier-shaped until a 2nd modality is real.
 *
 * This is the read-only FocusSnapshot split: affordances render as DISABLED metadata only
 * (no live commands). Live drivers (FocusLiveSession) are deferred (L3+).
 */

/**
 * A stable reference to the source entity this document projects (e.g. a track decision id).
 * Opaque at L1 (fixture-driven); L2 binds it to the real track `DecisionDossierView`.
 */
export type FocusRef = string;

/**
 * A stable reference to a rendered element — every rendered node is an interaction target.
 * At L1 these are inert (affordances are disabled metadata); they exist so L3+ live drivers
 * can route commands without re-deriving identity.
 */
export type TargetRef = string;

/** Outcome modalities. The decision-dossier's primary modality is `decision`. */
export type OutcomeModality = "decision" | "orientation" | "amendment" | "comment";

/** Diagram syntaxes. Diagrams render as a FENCED fallback only at L1 (no diagram adapter). */
export type DiagramSyntax = "mermaid" | "plantuml";

/** Q/R validation state for a `question` node (recommendation = préco). */
export type QuestionValidationState = "open" | "answered" | "validated";

/** Annotation state for an `option` node (Claude-style accept/reject/comment). */
export type OptionAnnotationState = "none" | "accept" | "reject" | "comment";

/** Base fields shared by every rendered node: a stable id + an interaction target ref. */
interface FocusNodeBase {
  readonly id: string;
  readonly targetRef: TargetRef;
}

/** Markdown prose body. The renderer injects the markdown→string conversion (host hook). */
export interface ProseNode extends FocusNodeBase {
  readonly kind: "prose";
  readonly markdown: string;
}

/** A question with a recommended answer (préco) and a validation state. */
export interface QuestionNode extends FocusNodeBase {
  readonly kind: "question";
  readonly question: string;
  /** The recommended answer (préco). Optional — a question may be open with no préco yet. */
  readonly recommendedAnswer?: string;
  /** The actual answer, when answered. */
  readonly answer?: string;
  readonly state: QuestionValidationState;
}

/** A single option/proposal/alternative with a Claude-style annotation state. */
export interface OptionNode extends FocusNodeBase {
  readonly kind: "option";
  readonly label: string;
  readonly body?: string;
  readonly annotation: OptionAnnotationState;
  /** Optional free-text comment carried with a `comment` annotation. */
  readonly annotationComment?: string;
}

/** A set of mutually-related options/proposals. */
export interface OptionSetNode extends FocusNodeBase {
  readonly kind: "optionSet";
  readonly title?: string;
  readonly options: readonly OptionNode[];
}

/** The modality-tagged outcome of the focus. */
export interface OutcomeNode extends FocusNodeBase {
  readonly kind: "outcome";
  readonly modality: OutcomeModality;
  readonly statement: string;
}

/** One ordered step of the amendment trace. */
export interface AmendmentStep {
  readonly at: string;
  readonly author: string;
  readonly summary: string;
}

/** The ordered amendment trace, rendered as a section. */
export interface AmendmentTraceNode extends FocusNodeBase {
  readonly kind: "amendmentTrace";
  readonly steps: readonly AmendmentStep[];
}

/** A diagram. At L1 this renders as a fenced fallback only (no diagram adapter). */
export interface DiagramNode extends FocusNodeBase {
  readonly kind: "diagram";
  readonly syntax: DiagramSyntax;
  readonly source: string;
  readonly alt: string;
}

/** The node families needed to render a decision-dossier. */
export type FocusNode =
  | ProseNode
  | QuestionNode
  | OptionSetNode
  | OutcomeNode
  | AmendmentTraceNode
  | DiagramNode;

/**
 * An affordance = a potential interaction surfaced on the snapshot. At L1 these are DISABLED
 * metadata only (read-only FocusSnapshot): no live command is submitted. L3+ FocusLiveSession
 * maps an affordance name → a track WorkEventKind. Never invent kinds.
 */
export interface Affordance {
  readonly name: string;
  /** The target this affordance would act on (a node's targetRef). */
  readonly targetRef: TargetRef;
  /** Human-readable label for the disabled-affordance metadata. */
  readonly label: string;
  /**
   * Always `false` at L1 — the snapshot is read-only. Kept explicit so renderers print the
   * disabled state and L3+ can flip it for live sessions.
   */
  readonly enabled: false;
}

/**
 * Comprehension evidence carried VERBATIM from the dossier artifacts (subject/dossierHash/sig
 * intact, NOT re-derived lineage — the confused-deputy fix). At L1 it is opaque provenance.
 */
export interface ComprehensionEvidence {
  readonly subject: string;
  readonly dossierHash: string;
  readonly signature?: string;
}

/** Provenance of the projection (where the data came from + when it was read). */
export interface FocusProvenance {
  readonly source: string;
  readonly readAt: string;
  readonly comprehensionEvidence?: ComprehensionEvidence;
}

/**
 * The CONCRETE decision-dossier document — a FocusDocument whose primary outcome modality is a
 * decision. Maps to track `DecisionDossierView{outcome,dossier,comprehensionEvidence}` +
 * `amendmentTrace` (wired for real at L2).
 */
export interface DecisionDossierDocument {
  readonly ref: FocusRef;
  readonly subject: string;
  readonly title: string;
  /** OCC base hash for the snapshot — used by L3+ reconcile; inert metadata at L1. */
  readonly hash: string;
  /** Read cursor / version marker from the source. */
  readonly cursor: string;
  readonly sections: readonly FocusNode[];
  /** Disabled-affordance metadata (read-only snapshot). */
  readonly interactions: readonly Affordance[];
  readonly provenance: FocusProvenance;
  readonly amendmentTrace: readonly AmendmentStep[];
}

/** A Track-native decision location. h2a dossiers are intentionally not accepted here. */
export interface TrackNativeDecisionTarget {
  readonly workspace: string;
  readonly decisionId: FocusRef;
}

/** The sole Track owner-signature contract accepted and emitted by this package. */
export const FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION = "track-owner-signature/1.0.0" as const;

/** A package-owned, closed contract version: callers cannot compose an arbitrary version. */
export type FocusOwnerSignatureContractVersion = typeof FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION;

/** Opaque proof that only an own-principal authentication adapter may verify. */
export interface OwnPrincipalAuthentication {
  readonly kind: "own-principal";
  readonly proof: unknown;
}

/** A normalized, issuer-scoped identity supplied by a trusted authentication boundary. */
export interface CanonicalPrincipalIdentity {
  readonly issuer: string;
  readonly subject: string;
}

/** The authenticated owner identity returned by the trusted own-principal adapter. */
export interface AuthenticatedOwnPrincipal {
  readonly principalId: string;
  readonly canonicalIdentity: CanonicalPrincipalIdentity;
  readonly authenticatedAt: string;
}

/** Transport provenance is a relayer record, never the owner attester. */
export interface RelayerProvenance {
  readonly transport: "cli" | "http" | "mcp-stdio" | "internal";
  readonly relayerId: string;
  readonly canonicalIdentity: CanonicalPrincipalIdentity;
}

/** The authenticated owner act that the Track signature contract must persist. */
export interface OwnerSignatureAttestation {
  readonly attester: AuthenticatedOwnPrincipal;
}

/** A request to accept one existing Track-native decision. */
export interface OwnerSignatureRequest {
  readonly target: TrackNativeDecisionTarget;
  readonly authentication: OwnPrincipalAuthentication;
  readonly idempotencyKey: string;
}

/** Exact, versioned write shape submitted to a Track owner-signature adapter. */
export interface TrackOwnerSignatureWrite {
  readonly contractVersion: FocusOwnerSignatureContractVersion;
  readonly target: TrackNativeDecisionTarget;
  readonly attestation: OwnerSignatureAttestation;
  readonly relayer: RelayerProvenance;
  readonly idempotencyKey: string;
}

/** Persisted read-back record required before an owner signature may be reported. */
export interface PersistedOwnerSignature extends TrackOwnerSignatureWrite {
  readonly recordId: string;
}

/**
 * The atomic uniqueness identity for a persisted owner acceptance. One owner may attest to a
 * given Track-native decision once, irrespective of transport retries or idempotency keys.
 */
export interface OwnerSignatureIdentity {
  /**
   * The normalized issuer+subject identity of the authenticated owner. This is the identity
   * used for the durable unique constraint, never a caller-supplied display identifier.
   */
  readonly ownerCanonicalIdentity: CanonicalPrincipalIdentity;
  readonly target: TrackNativeDecisionTarget;
}

/** The Track adapter must say whether an idempotency replay created or reused a record. */
export type TrackOwnerSignatureWriteResult =
  | { readonly status: "written"; readonly recordId: string }
  | { readonly status: "duplicate"; readonly recordId: string };

/** Explicit honest-not-done outcomes; none represent an owner signature. */
export type OwnerSignatureNotDoneReason =
  | "invalid-signature-request"
  | "owner-authentication-required"
  | "owner-authentication-invalid"
  | "relayer-provenance-invalid"
  | "authorization-denied"
  | "attester-relayer-conflict"
  | "track-contract-mismatch"
  | "track-write-failed"
  | "persisted-attestation-not-confirmed";

/** A live attempt either returns verified persisted evidence or an honest not-done result. */
export type OwnerSignatureResult =
  | {
      readonly status: "signed";
      readonly duplicate: boolean;
      readonly persisted: PersistedOwnerSignature;
    }
  | {
      readonly status: "not-done";
      readonly reason: OwnerSignatureNotDoneReason;
    };

/** The live write surface; a snapshot never implements this contract. */
export interface FocusLiveSession {
  sign(request: OwnerSignatureRequest): Promise<OwnerSignatureResult>;
}
