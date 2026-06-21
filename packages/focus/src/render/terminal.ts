/**
 * Terminal renderer (Focus-M1 L1).
 *
 * Renders a `DecisionDossierDocument` to a plain-text terminal string. Read-only FocusSnapshot:
 * affordances appear as disabled metadata; diagrams fall back to text (no diagram adapter);
 * markdown prose is emitted as-is (terminal has no markdown engine).
 *
 * Align the CLI/terminal render with ARCH-21 resource_terminal / RF11 renderer (no duplication):
 * this stays a pure string builder with no ANSI/color side effects.
 */

import type {
  Affordance,
  AmendmentStep,
  DecisionDossierDocument,
  FocusNode,
} from "../model.js";

export interface TerminalRenderOptions {
  /** Column width hint for rule lines. Default 72. */
  readonly width?: number;
}

const rule = (width: number): string => "=".repeat(Math.max(8, width));

const renderQuestion = (
  q: Extract<FocusNode, { kind: "question" }>,
): string => {
  const lines = [`Q: ${q.question}  [${q.state}]`];
  if (q.recommendedAnswer !== undefined) {
    lines.push(`   préco: ${q.recommendedAnswer}`);
  }
  if (q.answer !== undefined) {
    lines.push(`   answer: ${q.answer}`);
  }
  return lines.join("\n");
};

const renderOptionSet = (
  s: Extract<FocusNode, { kind: "optionSet" }>,
): string => {
  const head = s.title !== undefined ? `Options — ${s.title}` : "Options";
  const opts = s.options.map((o) => {
    const mark = o.annotation === "none" ? "( )" : `(${o.annotation})`;
    const comment =
      o.annotationComment !== undefined ? ` — ${o.annotationComment}` : "";
    const body = o.body !== undefined ? `\n      ${o.body}` : "";
    return `  ${mark} ${o.label}${comment}${body}`;
  });
  return [head, ...opts].join("\n");
};

const renderAmendmentTrace = (
  steps: readonly AmendmentStep[],
): string => {
  if (steps.length === 0) return "Amendment trace: (none)";
  const lines = steps.map(
    (st, i) => `  ${i + 1}. [${st.at}] ${st.author}: ${st.summary}`,
  );
  return ["Amendment trace:", ...lines].join("\n");
};

const renderDiagram = (
  d: Extract<FocusNode, { kind: "diagram" }>,
): string =>
  [
    `Diagram (${d.syntax}) — ${d.alt}`,
    ...d.source.split("\n").map((l) => `  | ${l}`),
  ].join("\n");

const renderNode = (node: FocusNode): string => {
  switch (node.kind) {
    case "prose":
      return node.markdown;
    case "question":
      return renderQuestion(node);
    case "optionSet":
      return renderOptionSet(node);
    case "outcome":
      return `Outcome [${node.modality}]: ${node.statement}`;
    case "amendmentTrace":
      return renderAmendmentTrace(node.steps);
    case "diagram":
      return renderDiagram(node);
  }
};

const renderAffordances = (affordances: readonly Affordance[]): string => {
  if (affordances.length === 0) return "";
  const lines = affordances.map(
    (a) => `  [disabled] ${a.label} (${a.name} → ${a.targetRef})`,
  );
  return ["Affordances (read-only snapshot):", ...lines].join("\n");
};

/** Render a decision-dossier document to a terminal string. */
export const renderTerminal = (
  doc: DecisionDossierDocument,
  opts: TerminalRenderOptions = {},
): string => {
  const width = opts.width ?? 72;
  const blocks: string[] = [
    rule(width),
    `${doc.title}`,
    `subject: ${doc.subject}`,
    `ref: ${doc.ref}  cursor: ${doc.cursor}`,
    rule(width),
  ];

  for (const node of doc.sections) {
    blocks.push(renderNode(node));
  }

  blocks.push(renderAmendmentTrace(doc.amendmentTrace));

  const affordances = renderAffordances(doc.interactions);
  if (affordances !== "") blocks.push(affordances);

  return blocks.join("\n\n") + "\n";
};
