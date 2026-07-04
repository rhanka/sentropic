/**
 * HTML renderer (Focus-M1) — MANDATORY surface.
 *
 * Renders a `DecisionDossierDocument` to an HTML string. Read-only FocusSnapshot: affordances appear
 * as DISABLED metadata; diagrams fall back to a `<pre>` block (no diagram adapter). Prose + the rich
 * option/question/outcome bodies are rendered as markdown by a built-in default (`marked`, see
 * ./markdown.ts) unless the host supplies a `renderMarkdown` override; the full document HTML is run
 * through the host `sanitizeHtml` hook before emission. Chrome labels are localized FR-first via
 * ./i18n.ts (`doc.locale`); `<html lang>` follows the authored content `doc.language`. The enriched
 * model (F3) carries per-option rationale / consequence / impact / recommended and an outcome
 * verdict / motivation so a dossier reads detailed + motivated. The renderer core owns structure only;
 * hosts own sanitization/styling.
 *
 * Theming is OPT-IN and additive (see {@link FocusHtmlTheme}).
 */

import type {
  Affordance,
  AmendmentStep,
  FocusNode,
  DecisionDossierDocument,
  OptionNode,
} from "../model.js";
import type { HtmlRenderHooks, RenderMarkdown } from "./hooks.js";
import type { FocusChrome } from "./i18n.js";
import { getChrome, resolveHtmlLang } from "./i18n.js";
import { defaultRenderMarkdown } from "./markdown.js";
import type { FocusHtmlTheme } from "./theme.js";
import { wrapThemedHtmlDocument } from "./theme.js";

/** Minimal HTML text escaping for attribute/text content the renderer itself emits. */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** An eyebrow-labeled markdown block (label + rendered markdown). */
const labeledMd = (
  label: string,
  markdown: string,
  md: RenderMarkdown,
  cls: string,
): string =>
  `<div class="${cls}"><span class="focus-eyebrow">${escapeHtml(label)}</span>${md(markdown)}</div>`;

const renderQuestion = (
  q: Extract<FocusNode, { kind: "question" }>,
  md: RenderMarkdown,
  c: FocusChrome,
): string => {
  const parts = [
    `<p class="focus-q"><strong>${escapeHtml(c.question)}:</strong> ${escapeHtml(q.question)} <em>(${escapeHtml(c.state[q.state])})</em></p>`,
  ];
  if (q.context !== undefined) {
    parts.push(`<div class="focus-q-context">${md(q.context)}</div>`);
  }
  if (q.recommendedAnswer !== undefined) {
    parts.push(
      `<p class="focus-preco">${escapeHtml(c.preco)}: ${escapeHtml(q.recommendedAnswer)}</p>`,
    );
  }
  if (q.answer !== undefined) {
    parts.push(
      `<p class="focus-answer">${escapeHtml(c.answer)}: ${escapeHtml(q.answer)}</p>`,
    );
  }
  if (q.stakes !== undefined) {
    parts.push(labeledMd(c.stakes, q.stakes, md, "focus-q-stakes"));
  }
  return `<section class="focus-question">${parts.join("")}</section>`;
};

const renderOption = (
  o: OptionNode,
  md: RenderMarkdown,
  c: FocusChrome,
): string => {
  const badge =
    o.recommended === true
      ? ` <span class="focus-badge focus-badge-recommended">${escapeHtml(c.recommended)}</span>`
      : "";
  const comment =
    o.annotationComment !== undefined
      ? ` <span class="focus-option-comment">— ${escapeHtml(o.annotationComment)}</span>`
      : "";
  const summary =
    o.summary !== undefined
      ? `<p class="focus-option-summary">${escapeHtml(o.summary)}</p>`
      : "";
  const body =
    o.body !== undefined
      ? `<div class="focus-option-body">${md(o.body)}</div>`
      : "";
  const rationale =
    o.rationale !== undefined
      ? labeledMd(c.rationale, o.rationale, md, "focus-option-rationale")
      : "";
  const consequence =
    o.consequenceIfChosen !== undefined
      ? labeledMd(c.consequence, o.consequenceIfChosen, md, "focus-option-consequence")
      : "";
  const impact =
    o.impact !== undefined
      ? labeledMd(c.impact, o.impact, md, "focus-option-impact")
      : "";
  const rec = o.recommended === true ? ' data-recommended="true"' : "";
  return (
    `<li class="focus-option" data-annotation="${escapeHtml(o.annotation)}"${rec}>` +
    `<p class="focus-option-head"><strong>${escapeHtml(o.label)}</strong>${badge}${comment}</p>` +
    summary +
    body +
    rationale +
    consequence +
    impact +
    "</li>"
  );
};

const renderOptionSet = (
  s: Extract<FocusNode, { kind: "optionSet" }>,
  md: RenderMarkdown,
  c: FocusChrome,
): string => {
  const head =
    s.title !== undefined
      ? `<h3>${escapeHtml(c.optionsWith(s.title))}</h3>`
      : `<h3>${escapeHtml(c.options)}</h3>`;
  const items = s.options.map((o) => renderOption(o, md, c));
  return `<section class="focus-optionset">${head}<ul>${items.join("")}</ul></section>`;
};

const renderOutcome = (
  node: Extract<FocusNode, { kind: "outcome" }>,
  md: RenderMarkdown,
  c: FocusChrome,
): string => {
  const verdict =
    node.verdict !== undefined
      ? `<p class="focus-verdict">${escapeHtml(node.verdict)}</p>`
      : "";
  const motivation =
    node.motivation !== undefined
      ? labeledMd(c.motivation, node.motivation, md, "focus-outcome-motivation")
      : "";
  return (
    `<section class="focus-outcome" data-modality="${escapeHtml(node.modality)}">` +
    `<h3>${escapeHtml(c.outcome)} (${escapeHtml(c.modality[node.modality])})</h3>` +
    verdict +
    `<p class="focus-outcome-statement">${escapeHtml(node.statement)}</p>` +
    motivation +
    "</section>"
  );
};

const renderAmendmentTrace = (
  steps: readonly AmendmentStep[],
  c: FocusChrome,
): string => {
  if (steps.length === 0) {
    return `<section class="focus-amendment-trace"><h3>${escapeHtml(c.amendmentTrace)}</h3><p><em>${escapeHtml(c.none)}</em></p></section>`;
  }
  const items = steps.map(
    (st) =>
      `<li><code>${escapeHtml(st.at)}</code> <strong>${escapeHtml(st.author)}</strong> — ${escapeHtml(st.summary)}</li>`,
  );
  return `<section class="focus-amendment-trace"><h3>${escapeHtml(c.amendmentTrace)}</h3><ol>${items.join("")}</ol></section>`;
};

const renderDiagram = (
  d: Extract<FocusNode, { kind: "diagram" }>,
): string =>
  `<figure class="focus-diagram" data-syntax="${escapeHtml(d.syntax)}"><figcaption>${escapeHtml(d.alt)}</figcaption><pre><code class="language-${escapeHtml(d.syntax)}">${escapeHtml(d.source)}</code></pre></figure>`;

const renderNode = (
  node: FocusNode,
  md: RenderMarkdown,
  c: FocusChrome,
): string => {
  switch (node.kind) {
    case "prose":
      return `<section class="focus-prose">${md(node.markdown)}</section>`;
    case "question":
      return renderQuestion(node, md, c);
    case "optionSet":
      return renderOptionSet(node, md, c);
    case "outcome":
      return renderOutcome(node, md, c);
    case "amendmentTrace":
      return renderAmendmentTrace(node.steps, c);
    case "diagram":
      return renderDiagram(node);
  }
};

const renderAffordances = (
  affordances: readonly Affordance[],
  c: FocusChrome,
): string => {
  if (affordances.length === 0) return "";
  const items = affordances.map((a) => {
    // Read-only snapshot: a legible disabled DS button + the copyable CLI command that performs it
    // live under `stp focus … --serve` (SPEC_EVOL_FOCUS_DS_PRESENTATION §2 D7/D9). No <del> corpse.
    const cmd = `stp focus ${a.targetRef} --${a.name}`;
    return (
      `<li class="focus-affordance" data-affordance="${escapeHtml(a.name)}" data-target="${escapeHtml(a.targetRef)}">` +
      `<span class="focus-affordance-btn" role="button" aria-disabled="true">${escapeHtml(a.label)}</span> ` +
      `<code class="focus-affordance-cmd">${escapeHtml(cmd)}</code></li>`
    );
  });
  return `<section class="focus-affordances"><h3>${escapeHtml(c.affordances)}</h3><ul>${items.join("")}</ul></section>`;
};

/**
 * Render a decision-dossier document to a sanitized HTML string.
 *
 * Default (no `theme`): the bare `focus-*` fragment, sanitized via the host hook — unchanged.
 * With `theme`: the sanitized fragment wrapped into a self-contained DS-themed document. Chrome labels
 * follow `doc.locale` (FR-first); `<html lang>` follows `doc.language`. Prose + rich bodies use the
 * built-in markdown default unless a host `renderMarkdown` override is supplied.
 */
export const renderHtml = (
  doc: DecisionDossierDocument,
  hooks: HtmlRenderHooks,
  theme?: FocusHtmlTheme,
): string => {
  const c = getChrome(doc.locale);
  const md: RenderMarkdown = hooks.renderMarkdown ?? defaultRenderMarkdown;

  const header =
    `<header class="focus-header"><h1>${escapeHtml(doc.title)}</h1>` +
    `<p class="focus-meta">${escapeHtml(c.subject)}: ${escapeHtml(doc.subject)} · ${escapeHtml(c.ref)}: <code>${escapeHtml(doc.ref)}</code> · ${escapeHtml(c.cursor)}: <code>${escapeHtml(doc.cursor)}</code></p></header>`;

  const sections = doc.sections
    .map((node) => renderNode(node, md, c))
    .join("");
  const amendment = renderAmendmentTrace(doc.amendmentTrace, c);
  const affordances = renderAffordances(doc.interactions, c);

  const html =
    `<article class="focus-document" data-ref="${escapeHtml(doc.ref)}">` +
    header +
    sections +
    amendment +
    affordances +
    "</article>";

  const sanitized = hooks.sanitizeHtml(html);
  if (theme === undefined) {
    return sanitized;
  }
  return wrapThemedHtmlDocument(sanitized, {
    title: doc.title,
    lang: resolveHtmlLang(doc.language, doc.locale),
    theme,
  });
};
