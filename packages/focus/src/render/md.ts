/**
 * Markdown renderer (Focus-M1 L1).
 *
 * Renders a `DecisionDossierDocument` to a Markdown string. Read-only FocusSnapshot:
 * affordances appear as disabled metadata; diagrams fall back to a FENCED code block
 * (```mermaid / ```plantuml — no diagram adapter). Prose markdown is emitted verbatim
 * (or passed through an optional host `renderMarkdown` hook for normalization).
 */

import type {
  Affordance,
  AmendmentStep,
  DecisionDossierDocument,
  FocusNode,
} from "../model.js";
import type { MdRenderHooks } from "./hooks.js";

const renderQuestion = (
  q: Extract<FocusNode, { kind: "question" }>,
): string => {
  const lines = [`**Q:** ${q.question} _(${q.state})_`];
  if (q.recommendedAnswer !== undefined) {
    lines.push(`- préco: ${q.recommendedAnswer}`);
  }
  if (q.answer !== undefined) {
    lines.push(`- answer: ${q.answer}`);
  }
  return lines.join("\n");
};

const renderOptionSet = (
  s: Extract<FocusNode, { kind: "optionSet" }>,
): string => {
  const head = s.title !== undefined ? `### Options — ${s.title}` : "### Options";
  const opts = s.options.map((o) => {
    const mark = o.annotation === "none" ? "[ ]" : `[${o.annotation}]`;
    const comment =
      o.annotationComment !== undefined ? ` — ${o.annotationComment}` : "";
    const body = o.body !== undefined ? `\n  ${o.body}` : "";
    return `- ${mark} **${o.label}**${comment}${body}`;
  });
  return [head, ...opts].join("\n");
};

const renderAmendmentTrace = (steps: readonly AmendmentStep[]): string => {
  if (steps.length === 0) return "### Amendment trace\n\n_(none)_";
  const lines = steps.map(
    (st, i) => `${i + 1}. \`${st.at}\` **${st.author}** — ${st.summary}`,
  );
  return ["### Amendment trace", "", ...lines].join("\n");
};

const renderDiagram = (
  d: Extract<FocusNode, { kind: "diagram" }>,
): string =>
  [`_${d.alt}_`, "", "```" + d.syntax, d.source, "```"].join("\n");

const renderNode = (node: FocusNode, hooks: MdRenderHooks): string => {
  switch (node.kind) {
    case "prose":
      return hooks.renderMarkdown !== undefined
        ? hooks.renderMarkdown(node.markdown)
        : node.markdown;
    case "question":
      return renderQuestion(node);
    case "optionSet":
      return renderOptionSet(node);
    case "outcome":
      return `### Outcome (${node.modality})\n\n${node.statement}`;
    case "amendmentTrace":
      return renderAmendmentTrace(node.steps);
    case "diagram":
      return renderDiagram(node);
  }
};

const renderAffordances = (affordances: readonly Affordance[]): string => {
  if (affordances.length === 0) return "";
  const lines = affordances.map(
    (a) => `- ~~${a.label}~~ \`${a.name}\` → \`${a.targetRef}\` _(disabled)_`,
  );
  return ["### Affordances (read-only snapshot)", "", ...lines].join("\n");
};

/** Render a decision-dossier document to a Markdown string. */
export const renderMd = (
  doc: DecisionDossierDocument,
  hooks: MdRenderHooks = {},
): string => {
  const blocks: string[] = [
    `# ${doc.title}`,
    `> subject: ${doc.subject}  ·  ref: \`${doc.ref}\`  ·  cursor: \`${doc.cursor}\``,
  ];

  for (const node of doc.sections) {
    blocks.push(renderNode(node, hooks));
  }

  blocks.push(renderAmendmentTrace(doc.amendmentTrace));

  const affordances = renderAffordances(doc.interactions);
  if (affordances !== "") blocks.push(affordances);

  return blocks.join("\n\n") + "\n";
};
