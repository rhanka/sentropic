/**
 * Hand-authored `DecisionDossierView`-shaped fixture (Focus-M1 L1).
 *
 * Mirrors track's `DecisionDossierView{outcome, dossier, comprehensionEvidence}` + `amendmentTrace`
 * with a representative decision-dossier: prose, a question with a préco, an option set with
 * accept/reject/comment annotations, a fenced-fallback diagram, an outcome, generic affordances,
 * and an amendment trace. L2 swaps this for a real `@sentropic/track/read` payload.
 */

import type { DecisionDossierViewFixture } from "../src/fixture.js";

export const decisionDossierFixture: DecisionDossierViewFixture = {
  id: "decision:focus-render-core",
  subject: "Focus-M1 L1 render-core packaging",
  title: "Should focus ship a private render-core first?",
  hash: "sha256:abc123",
  cursor: "v7",
  outcome: {
    modality: "decision",
    statement:
      "Ship a PRIVATE @sentropic/focus render-core first; publish only after a real consumer wires it.",
    ratified: true,
  },
  dossier: {
    blocks: [
      {
        type: "prose",
        id: "ctx",
        markdown:
          "## Context\n\nThe decision-dossier is the **first** focus type. L1 is fixture-driven with no track dependency.",
      },
      {
        type: "question",
        id: "q-publish",
        question: "Publish @sentropic/focus at L1?",
        recommendedAnswer: "No — keep it private until a real consumer wires it.",
        answer: "No.",
        state: "validated",
      },
      {
        type: "optionSet",
        id: "opts-packaging",
        title: "Packaging strategy",
        options: [
          {
            id: "opt-private",
            label: "Private app-local package",
            body: "private: true, extract later",
            annotation: "accept",
          },
          {
            id: "opt-publish",
            label: "Publish immediately",
            annotation: "reject",
            annotationComment: "Violates the real-consumption rule.",
          },
          {
            id: "opt-inline",
            label: "Inline in @sentropic/cli",
            annotation: "comment",
            annotationComment: "Loses the reusable boundary.",
          },
        ],
      },
      {
        type: "diagram",
        id: "diag-flow",
        syntax: "mermaid",
        source: "flowchart LR\n  track --> focus --> render",
        alt: "Read track, build FocusDocument, render to a surface.",
      },
    ],
  },
  comprehensionEvidence: {
    subject: "Focus-M1 L1 render-core packaging",
    dossierHash: "sha256:abc123",
    signature: "sig:deadbeef",
  },
  affordances: [
    {
      name: "ratifyOutcome",
      targetRef: "decision:focus-render-core:outcome",
      label: "Ratify the decision",
    },
    {
      name: "amendSpec",
      targetRef: "decision:focus-render-core",
      label: "Amend the spec",
    },
  ],
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
  source: "fixture",
  readAt: "2026-06-21T12:00:00Z",
};
