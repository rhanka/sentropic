/**
 * Local `DecisionDossierView`-shaped fixture type + mapper (Focus-M1 L1).
 *
 * Per SPEC_VOL_FOCUS §4b L1 row: there is NO `@sentropic/track` dependency at L1, so we define
 * a LOCAL fixture type mirroring the relevant fields of track's
 * `DecisionDossierView{outcome, dossier, comprehensionEvidence}` + `amendmentTrace`. L2
 * (`feat/focus-track-read`) replaces this local type with the real `@sentropic/track/read`
 * `DecisionDossierView` and `amendmentTrace(id)` and reuses the SAME mapper shape.
 *
 * NOTE on track shape (verified, SPEC §4 review): track's `DecisionDossierView` is
 * `outcome + dossier(OPAQUE) + report/rollup + generic affordances` — the typed Q/R/option/
 * cerclage/diagram FocusNodes are NOT proven to exist in track reads. This fixture therefore
 * keeps the dossier body as opaque structured content the mapper projects into typed FocusNodes;
 * L2 must confirm the real field shapes before binding.
 */

import type {
  AmendmentStep,
  DecisionDossierDocument,
  DiagramSyntax,
  FocusNode,
  OptionAnnotationState,
  OutcomeModality,
  QuestionValidationState,
} from "./model.js";

/** Mirror of the track outcome envelope (modality-tagged decision). */
export interface FixtureOutcome {
  readonly modality: OutcomeModality;
  readonly statement: string;
  readonly ratified?: boolean;
}

/** Generic affordance as track surfaces it (read-only — disabled in the snapshot). */
export interface FixtureAffordance {
  readonly name: string;
  readonly targetRef: string;
  readonly label: string;
}

/** A dossier body block — the (opaque-to-track) structured content the mapper projects. */
export type FixtureDossierBlock =
  | { readonly type: "prose"; readonly id: string; readonly markdown: string }
  | {
      readonly type: "question";
      readonly id: string;
      readonly question: string;
      readonly recommendedAnswer?: string;
      readonly answer?: string;
      readonly state: QuestionValidationState;
    }
  | {
      readonly type: "optionSet";
      readonly id: string;
      readonly title?: string;
      readonly options: ReadonlyArray<{
        readonly id: string;
        readonly label: string;
        readonly body?: string;
        readonly annotation: OptionAnnotationState;
        readonly annotationComment?: string;
      }>;
    }
  | {
      readonly type: "diagram";
      readonly id: string;
      readonly syntax: DiagramSyntax;
      readonly source: string;
      readonly alt: string;
    };

/** Mirror of track's `DecisionDossierView` + `amendmentTrace` (local fixture shape for L1). */
export interface DecisionDossierViewFixture {
  readonly id: string;
  readonly subject: string;
  readonly title: string;
  readonly hash: string;
  readonly cursor: string;
  readonly outcome: FixtureOutcome;
  readonly dossier: {
    readonly blocks: readonly FixtureDossierBlock[];
  };
  readonly comprehensionEvidence?: {
    readonly subject: string;
    readonly dossierHash: string;
    readonly signature?: string;
  };
  readonly affordances: readonly FixtureAffordance[];
  readonly amendmentTrace: readonly AmendmentStep[];
  readonly source: string;
  readonly readAt: string;
}

const mapBlock = (block: FixtureDossierBlock): FocusNode => {
  switch (block.type) {
    case "prose":
      return {
        kind: "prose",
        id: block.id,
        targetRef: block.id,
        markdown: block.markdown,
      };
    case "question":
      return {
        kind: "question",
        id: block.id,
        targetRef: block.id,
        question: block.question,
        recommendedAnswer: block.recommendedAnswer,
        answer: block.answer,
        state: block.state,
      };
    case "optionSet":
      return {
        kind: "optionSet",
        id: block.id,
        targetRef: block.id,
        title: block.title,
        options: block.options.map((o) => ({
          kind: "option",
          id: o.id,
          targetRef: o.id,
          label: o.label,
          body: o.body,
          annotation: o.annotation,
          annotationComment: o.annotationComment,
        })),
      };
    case "diagram":
      return {
        kind: "diagram",
        id: block.id,
        targetRef: block.id,
        syntax: block.syntax,
        source: block.source,
        alt: block.alt,
      };
  }
};

/**
 * Map a `DecisionDossierViewFixture` (L1) / real `DecisionDossierView` (L2) into the concrete
 * `DecisionDossierDocument`. The outcome is appended as a terminal `outcome` node; the amendment
 * trace is carried both as the doc-level `amendmentTrace` and rendered as a section by each
 * renderer. Generic affordances become disabled-snapshot metadata.
 */
export const toDecisionDossierDocument = (
  view: DecisionDossierViewFixture,
): DecisionDossierDocument => {
  const sections: FocusNode[] = view.dossier.blocks.map(mapBlock);

  sections.push({
    kind: "outcome",
    id: `${view.id}:outcome`,
    targetRef: `${view.id}:outcome`,
    modality: view.outcome.modality,
    statement: view.outcome.statement,
  });

  return {
    ref: view.id,
    subject: view.subject,
    title: view.title,
    hash: view.hash,
    cursor: view.cursor,
    sections,
    interactions: view.affordances.map((a) => ({
      name: a.name,
      targetRef: a.targetRef,
      label: a.label,
      enabled: false,
    })),
    provenance: {
      source: view.source,
      readAt: view.readAt,
      comprehensionEvidence: view.comprehensionEvidence,
    },
    amendmentTrace: view.amendmentTrace,
  };
};
