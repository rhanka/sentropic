/**
 * HTML renderer (Focus-M1 L1) — MANDATORY surface.
 *
 * Renders a `DecisionDossierDocument` to an HTML string. Read-only FocusSnapshot:
 * affordances appear as DISABLED metadata; diagrams fall back to a `<pre>` block (no diagram
 * adapter). Markdown prose is converted via the host-supplied `renderMarkdown` hook (NO `marked`
 * dep, NO mdast core); the full document HTML is run through the host `sanitizeHtml` hook before
 * emission. The renderer core owns structure only; hosts own sanitization/styling.
 */

import type {
  Affordance,
  AmendmentStep,
  DecisionDossierDocument,
  FocusNode,
} from "../model.js";
import type { HtmlRenderHooks } from "./hooks.js";

/** Minimal HTML text escaping for attribute/text content the renderer itself emits. */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const renderQuestion = (
  q: Extract<FocusNode, { kind: "question" }>,
): string => {
  const parts = [
    `<p class="focus-q"><strong>Q:</strong> ${escapeHtml(q.question)} <em>(${escapeHtml(q.state)})</em></p>`,
  ];
  if (q.recommendedAnswer !== undefined) {
    parts.push(
      `<p class="focus-preco">préco: ${escapeHtml(q.recommendedAnswer)}</p>`,
    );
  }
  if (q.answer !== undefined) {
    parts.push(`<p class="focus-answer">answer: ${escapeHtml(q.answer)}</p>`);
  }
  return `<section class="focus-question">${parts.join("")}</section>`;
};

const renderOptionSet = (
  s: Extract<FocusNode, { kind: "optionSet" }>,
): string => {
  const head =
    s.title !== undefined
      ? `<h3>Options — ${escapeHtml(s.title)}</h3>`
      : "<h3>Options</h3>";
  const items = s.options.map((o) => {
    const comment =
      o.annotationComment !== undefined
        ? ` <span class="focus-option-comment">— ${escapeHtml(o.annotationComment)}</span>`
        : "";
    const body =
      o.body !== undefined
        ? `<div class="focus-option-body">${escapeHtml(o.body)}</div>`
        : "";
    return `<li class="focus-option" data-annotation="${escapeHtml(o.annotation)}"><strong>${escapeHtml(o.label)}</strong>${comment}${body}</li>`;
  });
  return `<section class="focus-optionset">${head}<ul>${items.join("")}</ul></section>`;
};

const renderAmendmentTrace = (steps: readonly AmendmentStep[]): string => {
  if (steps.length === 0) {
    return `<section class="focus-amendment-trace"><h3>Amendment trace</h3><p><em>(none)</em></p></section>`;
  }
  const items = steps.map(
    (st) =>
      `<li><code>${escapeHtml(st.at)}</code> <strong>${escapeHtml(st.author)}</strong> — ${escapeHtml(st.summary)}</li>`,
  );
  return `<section class="focus-amendment-trace"><h3>Amendment trace</h3><ol>${items.join("")}</ol></section>`;
};

const renderDiagram = (
  d: Extract<FocusNode, { kind: "diagram" }>,
): string =>
  `<figure class="focus-diagram" data-syntax="${escapeHtml(d.syntax)}"><figcaption>${escapeHtml(d.alt)}</figcaption><pre><code class="language-${escapeHtml(d.syntax)}">${escapeHtml(d.source)}</code></pre></figure>`;

const renderNode = (node: FocusNode, hooks: HtmlRenderHooks): string => {
  switch (node.kind) {
    case "prose":
      return `<section class="focus-prose">${hooks.renderMarkdown(node.markdown)}</section>`;
    case "question":
      return renderQuestion(node);
    case "optionSet":
      return renderOptionSet(node);
    case "outcome":
      return `<section class="focus-outcome" data-modality="${escapeHtml(node.modality)}"><h3>Outcome (${escapeHtml(node.modality)})</h3><p>${escapeHtml(node.statement)}</p></section>`;
    case "amendmentTrace":
      return renderAmendmentTrace(node.steps);
    case "diagram":
      return renderDiagram(node);
  }
};

const renderAffordances = (affordances: readonly Affordance[]): string => {
  if (affordances.length === 0) return "";
  const items = affordances.map(
    (a) =>
      `<li class="focus-affordance" data-affordance="${escapeHtml(a.name)}" data-target="${escapeHtml(a.targetRef)}" aria-disabled="true"><del>${escapeHtml(a.label)}</del> <span class="focus-affordance-meta">${escapeHtml(a.name)} → ${escapeHtml(a.targetRef)} (disabled)</span></li>`,
  );
  return `<section class="focus-affordances"><h3>Affordances (read-only snapshot)</h3><ul>${items.join("")}</ul></section>`;
};

/** Render a decision-dossier document to a sanitized HTML string. */
export const renderHtml = (
  doc: DecisionDossierDocument,
  hooks: HtmlRenderHooks,
): string => {
  const header =
    `<header class="focus-header"><h1>${escapeHtml(doc.title)}</h1>` +
    `<p class="focus-meta">subject: ${escapeHtml(doc.subject)} · ref: <code>${escapeHtml(doc.ref)}</code> · cursor: <code>${escapeHtml(doc.cursor)}</code></p></header>`;

  const sections = doc.sections.map((node) => renderNode(node, hooks)).join("");
  const amendment = renderAmendmentTrace(doc.amendmentTrace);
  const affordances = renderAffordances(doc.interactions);

  const html =
    `<article class="focus-document" data-ref="${escapeHtml(doc.ref)}">` +
    header +
    sections +
    amendment +
    affordances +
    "</article>";

  return hooks.sanitizeHtml(html);
};
