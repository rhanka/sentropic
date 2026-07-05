/**
 * Hand-authored `DecisionDossierDocument` fixture for the renderer specs (Focus-M1 L2).
 *
 * L1 built this document via a LOCAL `DecisionDossierViewFixture` type + mapper; L2 replaced that
 * local type with the REAL `@sentropic/track/read` binding (`src/track/index.ts`), so the renderer
 * specs now construct the `DecisionDossierDocument` DIRECTLY from the model (the renderers are
 * surface-agnostic — they take a `DecisionDossierDocument`, not a track view). A representative
 * decision-dossier: prose, a question with a préco, an option set with accept/reject/comment
 * annotations, a fenced-fallback diagram, an outcome, disabled affordances, and an amendment trace.
 */

import type { DecisionDossierDocument } from "../src/model.js";

export const decisionDossierFixture: DecisionDossierDocument = {
  ref: "decision:focus-render-core",
  subject: "Focus-M1 L1 render-core packaging",
  title: "Should focus ship a private render-core first?",
  hash: "sha256:abc123",
  cursor: "v7",
  sections: [
    {
      kind: "prose",
      id: "ctx",
      targetRef: "ctx",
      markdown:
        "## Context\n\nThe decision-dossier is the **first** focus type. L1 is fixture-driven with no track dependency.",
    },
    {
      kind: "question",
      id: "q-publish",
      targetRef: "q-publish",
      question: "Publish @sentropic/focus at L1?",
      recommendedAnswer: "No — keep it private until a real consumer wires it.",
      answer: "No.",
      state: "validated",
    },
    {
      kind: "optionSet",
      id: "opts-packaging",
      targetRef: "opts-packaging",
      title: "Packaging strategy",
      options: [
        {
          kind: "option",
          id: "opt-private",
          targetRef: "opt-private",
          label: "Private app-local package",
          body: "private: true, extract later",
          annotation: "accept",
        },
        {
          kind: "option",
          id: "opt-publish",
          targetRef: "opt-publish",
          label: "Publish immediately",
          annotation: "reject",
          annotationComment: "Violates the real-consumption rule.",
        },
        {
          kind: "option",
          id: "opt-inline",
          targetRef: "opt-inline",
          label: "Inline in @sentropic/cli",
          annotation: "comment",
          annotationComment: "Loses the reusable boundary.",
        },
      ],
    },
    {
      kind: "diagram",
      id: "diag-flow",
      targetRef: "diag-flow",
      syntax: "mermaid",
      source: "flowchart LR\n  track --> focus --> render",
      alt: "Read track, build FocusDocument, render to a surface.",
    },
    {
      kind: "outcome",
      id: "decision:focus-render-core:outcome",
      targetRef: "decision:focus-render-core:outcome",
      modality: "decision",
      statement:
        "Ship a PRIVATE @sentropic/focus render-core first; publish only after a real consumer wires it.",
    },
  ],
  interactions: [
    {
      name: "ratifyOutcome",
      targetRef: "decision:focus-render-core:outcome",
      label: "Ratify the decision",
      enabled: false,
    },
    {
      name: "amendSpec",
      targetRef: "decision:focus-render-core",
      label: "Amend the spec",
      enabled: false,
    },
  ],
  provenance: {
    source: "fixture",
    readAt: "2026-06-21T12:00:00Z",
    comprehensionEvidence: {
      subject: "Focus-M1 L1 render-core packaging",
      dossierHash: "sha256:abc123",
      signature: "sig:deadbeef",
    },
  },
  amendmentTrace: [
    {
      at: "2026-06-20T10:00:00Z",
      author: "owner",
      summary: "Reframed decision-dossier as the first focus type.",
    },
    {
      at: "2026-06-21T09:00:00Z",
      author: "conductor",
      summary: "Split M1 into L1..L4; L1 is the fixture-driven render-core.",
    },
  ],
};
