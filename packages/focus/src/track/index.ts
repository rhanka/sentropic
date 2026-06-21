/**
 * `@sentropic/focus/track` — the read binding over `@sentropic/track/read` (Focus-M1 L2).
 *
 * Per SPEC_VOL_FOCUS §4b L2: binds the private `packages/focus` render-core to the REAL
 * `@sentropic/track` read API, replacing L1's local `DecisionDossierViewFixture` type + mapper.
 * A `TrackReader` read is PURE / read-only / clockless — NO auth, NO identity, NO clock (the L4
 * write lot is where identity enters). This module:
 *   1. reads a real `DecisionDossierView` from a track event log via
 *      `new TrackReader(eventsPath).canevas(workspace, { baselineCommit, decisionId }).dossier`,
 *   2. reads the ordered `amendmentTrace(decisionId)` for the same decision,
 *   3. maps both into the concrete L1 `DecisionDossierDocument`.
 *
 * It binds to the VERSIONED `@sentropic/track/read` subpath (NOT track's non-versioned barrel) and
 * gates on `reader.contractVersion` (the additive-only READ contract — consumers gate on it).
 */

import { TrackReader } from "@sentropic/track/read";
import type {
  AmendmentStep as TrackAmendmentStep,
  ComprehensionEvidence as TrackComprehensionEvidence,
  DecisionDossierView,
  Dossier,
  ItemId,
  Option,
  Outcome,
  QAEntry,
} from "@sentropic/track/read";

import type {
  AmendmentStep,
  ComprehensionEvidence,
  DecisionDossierDocument,
  FocusNode,
  OutcomeModality,
} from "../model.js";

/**
 * The major-compatible `@sentropic/track/read` READ contract this binding was written against.
 * The contract is additive-only within a major; we accept any matching major (gate below).
 */
export const EXPECTED_TRACK_READ_MAJOR = 1;

/** Locator of a real decision in a track event log. `workspace` scopes the canevas materialization. */
export interface FocusTrackQuery {
  /** The workspace the decision lives in (scopes the per-workspace canevas). */
  readonly workspace: string;
  /** The caller-supplied baseline commit (track holds no git; the adapter owns it). */
  readonly baselineCommit: string;
  /** The decision aggregate id to surface as a full dossier. */
  readonly decisionId: ItemId;
}

/** Thrown when the installed `@sentropic/track/read` contract major is incompatible. */
export class TrackContractMismatchError extends Error {
  constructor(
    readonly actual: string,
    readonly expectedMajor: number,
  ) {
    super(
      `@sentropic/track/read contract ${actual} is incompatible with focus/track ` +
        `(expects major ${expectedMajor}.x)`,
    );
    this.name = "TrackContractMismatchError";
  }
}

/** Thrown when a `decisionId` is not present (or not a decision) in the read log. */
export class DecisionNotFoundError extends Error {
  constructor(readonly decisionId: ItemId) {
    super(`decision ${decisionId} not found in the track read log`);
    this.name = "DecisionNotFoundError";
  }
}

const majorOf = (version: string): number => {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isNaN(major) ? -1 : major;
};

/** A `track` `Outcome` ('pending'|'go'|'no-go'|'deferred') → the focus outcome statement. */
const outcomeStatement = (outcome: Outcome): string => {
  switch (outcome) {
    case "go":
      return "GO — the decision is ratified.";
    case "no-go":
      return "NO-GO — the decision is declined.";
    case "deferred":
      return "DEFERRED — the decision is postponed.";
    case "pending":
      return "PENDING — the decision is not yet settled.";
  }
};

/** Map an `Option` (id/title/summary/pros?/cons?) into the focus `optionSet` body text. */
const optionBody = (option: Option): string | undefined => {
  const parts: string[] = [];
  if (option.pros !== undefined && option.pros.length > 0) {
    parts.push(`pros: ${option.pros.join("; ")}`);
  }
  if (option.cons !== undefined && option.cons.length > 0) {
    parts.push(`cons: ${option.cons.join("; ")}`);
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
};

/**
 * Extract the comprehension evidence carried VERBATIM on the dossier's
 * `kind:'h2a-decision-dossier'` artifacts. ComprehensionEvidence is NESTED (not a top-level
 * sibling of the view): `dossier.artifacts[] → .comprehension[]`. We keep `subject` (the NAMED
 * attester/decider) intact — it is DISTINCT from any channel principal that merely relayed the
 * write (the anti-confused-deputy invariant: never launder the origin).
 */
const collectComprehension = (
  dossier: Dossier,
): TrackComprehensionEvidence[] => {
  const out: TrackComprehensionEvidence[] = [];
  for (const artifact of dossier.artifacts ?? []) {
    if (artifact.kind === "h2a-decision-dossier") {
      for (const ev of artifact.comprehension ?? []) {
        out.push(ev);
      }
    }
  }
  return out;
};

/** Map a track `ComprehensionEvidence` into the focus model's verbatim shape (subject intact). */
const toFocusComprehension = (
  ev: TrackComprehensionEvidence,
): ComprehensionEvidence => ({
  subject: ev.subject,
  dossierHash: ev.dossierHash,
  ...(ev.sig !== undefined ? { signature: ev.sig.value } : {}),
});

/** Map a track `AmendmentStep` (seq/at/by/kind/prov/origin/...) into the focus amendment step. */
const toFocusAmendmentStep = (step: TrackAmendmentStep): AmendmentStep => ({
  at: step.at,
  // `by` is the actor on whose behalf the write was recorded; `origin` ('human'|'machine')
  // derives PURELY from `prov.proposed` — the machine origin is never laundered. We surface the
  // origin alongside the actor so the rendered trace is honest about machine-proposed steps.
  author: `${step.by} (${step.origin})`,
  summary: step.summary ?? step.kind,
});

/**
 * Build the focus `DecisionDossierDocument` sections from a real track `Dossier`:
 * a `prose` context node, one `question` per QA entry (préco = recommendation rationale when it
 * targets the answered option), an `optionSet` of the options, and a terminal `outcome` node.
 */
const buildSections = (
  view: DecisionDossierView,
): FocusNode[] => {
  const dossier = view.dossier;
  const sections: FocusNode[] = [];

  sections.push({
    kind: "prose",
    id: `${view.id}:context`,
    targetRef: `${view.id}:context`,
    markdown: dossier.context,
  });

  for (const qa of dossier.qa) {
    sections.push(mapQa(view.id, qa));
  }

  if (dossier.options.length > 0) {
    sections.push({
      kind: "optionSet",
      id: `${view.id}:options`,
      targetRef: `${view.id}:options`,
      title: "Options",
      options: dossier.options.map((opt) => ({
        kind: "option",
        id: opt.id,
        targetRef: opt.id,
        label: opt.title,
        ...(optionBody(opt) !== undefined ? { body: optionBody(opt) } : {}),
        // The annotation reflects the dossier's selection/recommendation, NOT a live action:
        // the selected option is 'accept'; the others are 'none' in this read-only snapshot.
        annotation:
          opt.id === dossier.selectedOptionId ? "accept" : "none",
        ...(dossier.recommendation?.optionId === opt.id
          ? { annotationComment: dossier.recommendation.rationale }
          : {}),
      })),
    });
  }

  sections.push({
    kind: "outcome",
    id: `${view.id}:outcome`,
    targetRef: `${view.id}:outcome`,
    modality: "decision" satisfies OutcomeModality,
    statement: outcomeStatement(view.outcome),
  });

  return sections;
};

const mapQa = (decisionId: ItemId, qa: QAEntry): FocusNode => ({
  kind: "question",
  id: qa.id,
  targetRef: qa.id,
  question: qa.question,
  ...(qa.answer !== undefined ? { answer: qa.answer } : {}),
  // A QA entry carries no separate préco field in the track contract; an answered entry is
  // 'answered', an open one is 'open'. (The validated state is only reachable via a live write.)
  state: qa.answer !== undefined ? "answered" : "open",
});

/**
 * Map a REAL track `DecisionDossierView` + its ordered `amendmentTrace` into the concrete L1
 * `DecisionDossierDocument`. The comprehension evidence is carried VERBATIM from the nested
 * `dossier.artifacts[] (kind:'h2a-decision-dossier').comprehension[]` (subject/hash/sig intact).
 */
export const toDecisionDossierDocument = (
  view: DecisionDossierView,
  amendmentTrace: readonly TrackAmendmentStep[],
  meta: { readonly source: string; readonly readAt: string; readonly cursor: string },
): DecisionDossierDocument => {
  const comprehension = collectComprehension(view.dossier);
  const firstComprehension = comprehension[0];

  return {
    ref: view.id,
    subject: view.workspace,
    title: view.title,
    // The dossier hash is the integrity tag the attester signed over; surface the first one as the
    // snapshot hash when present, else fall back to the read cursor.
    hash: firstComprehension?.dossierHash ?? meta.cursor,
    cursor: meta.cursor,
    sections: buildSections(view),
    // The read is a snapshot: the affordances are surfaced disabled by the renderers; this binding
    // does not invent live actions (those are L3+/L4). We leave interactions empty here — the
    // canevas affordances are NOT laundered into the read-only doc.
    interactions: [],
    provenance: {
      source: meta.source,
      readAt: meta.readAt,
      ...(firstComprehension !== undefined
        ? { comprehensionEvidence: toFocusComprehension(firstComprehension) }
        : {}),
    },
    amendmentTrace: amendmentTrace.map(toFocusAmendmentStep),
  };
};

/**
 * Read a real decision from a track event log and project it into a `DecisionDossierDocument`.
 *
 * PURE / read-only / clockless: the `readAt` timestamp is CALLER-supplied (track holds no clock),
 * and no auth/identity is involved. The binding gates on `reader.contractVersion` (additive-only
 * READ contract) and throws `TrackContractMismatchError` on an incompatible major.
 *
 * @param eventsPath  path to the track event log (`.track/events.jsonl`)
 * @param query       workspace + baseline commit + decision id
 * @param readAt      caller-supplied ISO-8601 read timestamp (no clock in track)
 */
export const readDecisionDossier = (
  eventsPath: string,
  query: FocusTrackQuery,
  readAt: string,
): DecisionDossierDocument => {
  const reader = new TrackReader(eventsPath);

  if (majorOf(reader.contractVersion) !== EXPECTED_TRACK_READ_MAJOR) {
    throw new TrackContractMismatchError(
      reader.contractVersion,
      EXPECTED_TRACK_READ_MAJOR,
    );
  }

  const canevas = reader.canevas(query.workspace, {
    baselineCommit: query.baselineCommit,
    decisionId: query.decisionId,
  });

  if (canevas.dossier === undefined) {
    throw new DecisionNotFoundError(query.decisionId);
  }

  const amendmentTrace = reader.amendmentTrace(query.decisionId);
  const cursor = reader.cursor();

  return toDecisionDossierDocument(canevas.dossier, amendmentTrace, {
    source: `track:${eventsPath}`,
    readAt,
    cursor: `count:${cursor.count}`,
  });
};
