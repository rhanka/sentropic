/**
 * Unit specs for the FocusSnapshot render-core (Focus-M1 L1).
 *
 * Asserts: the fixture maps to a `DecisionDossierDocument`; terminal/MD/HTML render the
 * structure; the amendment trace renders on all three; affordances appear as DISABLED metadata;
 * diagrams fall back to a fenced/`<pre>`/text block (no diagram adapter); markdown is injected
 * (MD passthrough, HTML via the host hook) and HTML is sanitized via the host hook.
 */

import { describe, expect, it } from "vitest";

import { renderHtml, renderMd, renderTerminal } from "../src/index.js";
import { FOCUS_COMPONENT_CSS } from "../src/index.js";
import type { HtmlRenderHooks } from "../src/index.js";
import { decisionDossierFixture } from "./fixture.data.js";

const doc = decisionDossierFixture;

// A trivial host markdown hook (NOT marked — proves injection). Wraps content in a marker.
const hooks: HtmlRenderHooks = {
  renderMarkdown: (md) => `<md>${md}</md>`,
  sanitizeHtml: (html) => `<!--sanitized-->${html}`,
};

describe("renderTerminal", () => {
  const out = renderTerminal(doc);

  it("renders the header, subject and outcome", () => {
    expect(out).toContain("Should focus ship a private render-core first?");
    expect(out).toContain("subject: Focus-M1 L1 render-core packaging");
    expect(out).toContain("Outcome [decision]:");
  });

  it("renders the question with its préco and the validated state", () => {
    expect(out).toContain("Q: Publish @sentropic/focus at L1?  [validated]");
    expect(out).toContain("préco:");
  });

  it("renders option annotations including accept/reject/comment", () => {
    expect(out).toContain("(accept) Private app-local package");
    expect(out).toContain("(reject) Publish immediately");
    expect(out).toContain("(comment) Inline in @sentropic/cli");
  });

  it("renders the amendment trace", () => {
    expect(out).toContain("Amendment trace:");
    expect(out).toContain("Reframed decision-dossier as the first focus type.");
  });

  it("renders the diagram as a text fallback (no adapter)", () => {
    expect(out).toContain("Diagram (mermaid)");
    expect(out).toContain("| flowchart LR");
  });

  it("renders affordances as disabled metadata", () => {
    expect(out).toContain("Affordances (read-only snapshot):");
    expect(out).toContain("[disabled] Ratify the decision");
  });
});

describe("renderMd", () => {
  const out = renderMd(doc);

  it("renders an H1 title and the meta line", () => {
    expect(out).toContain("# Should focus ship a private render-core first?");
    expect(out).toContain("subject: Focus-M1 L1 render-core packaging");
  });

  it("emits prose markdown verbatim by default (injection, no transform)", () => {
    expect(out).toContain("## Context");
    expect(out).toContain("**first** focus type");
  });

  it("applies an optional host renderMarkdown hook when provided", () => {
    const transformed = renderMd(doc, {
      renderMarkdown: (md) => md.toUpperCase(),
    });
    expect(transformed).toContain("## CONTEXT");
  });

  it("renders the diagram as a fenced code block (fallback)", () => {
    expect(out).toContain("```mermaid");
    expect(out).toContain("flowchart LR");
    expect(out).toContain("```");
  });

  it("renders the amendment trace section", () => {
    expect(out).toContain("### Amendment trace");
    expect(out).toContain("Split M1 into L1..L4");
  });

  it("renders affordances as disabled metadata", () => {
    expect(out).toContain("### Affordances (read-only snapshot)");
    expect(out).toContain("_(disabled)_");
  });
});

describe("renderHtml", () => {
  const out = renderHtml(doc, hooks);

  it("runs the whole document through the host sanitize hook", () => {
    expect(out.startsWith("<!--sanitized-->")).toBe(true);
  });

  it("renders the document article and header", () => {
    expect(out).toContain('<article class="focus-document"');
    expect(out).toContain("<h1>Should focus ship a private render-core first?</h1>");
  });

  it("injects markdown via the host renderMarkdown hook (no marked dep)", () => {
    expect(out).toContain("<md>## Context");
  });

  it("renders option annotations as data attributes", () => {
    expect(out).toContain('data-annotation="accept"');
    expect(out).toContain('data-annotation="reject"');
    expect(out).toContain('data-annotation="comment"');
  });

  it("renders the diagram as a <pre> fallback (no adapter)", () => {
    expect(out).toContain('class="focus-diagram"');
    expect(out).toContain('class="language-mermaid"');
    expect(out).toContain("flowchart LR");
  });

  it("renders the amendment trace section", () => {
    expect(out).toContain('class="focus-amendment-trace"');
    expect(out).toContain("Split M1 into L1..L4");
  });

  it("renders affordances as aria-disabled metadata", () => {
    expect(out).toContain('class="focus-affordance"');
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain('data-affordance="ratifyOutcome"');
  });

  it("escapes renderer-emitted text content", () => {
    expect(out).toContain("ref: <code>decision:focus-render-core</code>");
  });
});

describe("renderHtml — default output stays a bare fragment (reversible)", () => {
  const out = renderHtml(doc, hooks);

  it("emits no DS theme wrapper when no theme arg is supplied", () => {
    expect(out).not.toContain("data-st-theme");
    expect(out).not.toContain("<!DOCTYPE");
    expect(out).not.toContain("<html");
    expect(out).not.toContain("<style");
    expect(out).not.toContain("<link");
  });

  it("is byte-identical whether the theme arg is omitted or explicitly undefined", () => {
    expect(renderHtml(doc, hooks, undefined)).toBe(out);
  });
});

describe("renderHtml — DS-themed, self-contained document (opt-in)", () => {
  // A sentinel DS token sheet (proves the inlined CSS is the host-supplied one, not invented).
  const tokenCss = '[data-st-theme="entropic"]{--st-semantic-text-primary:#0f172a}';
  const out = renderHtml(doc, hooks, { themeId: "entropic", inlineCss: tokenCss });

  it("emits a self-contained html document scoped to the DS theme", () => {
    expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(out).toContain('<html lang="en" data-st-theme="entropic">');
    expect(out).toContain("</body></html>");
  });

  it("inlines the host-supplied DS token CSS in the head", () => {
    expect(out).toContain("<style data-focus-theme-tokens>");
    expect(out).toContain(tokenCss);
  });

  it("ships the Focus component stylesheet authored against DS tokens", () => {
    expect(out).toContain("<style data-focus-component-css>");
    expect(out).toContain(FOCUS_COMPONENT_CSS);
    expect(out).toContain(".focus-document");
    expect(out).toContain("var(--st-semantic-text-primary");
    expect(out).toContain("var(--st-spacing-");
    expect(out).toContain("var(--st-font-sans");
  });

  it("keeps the sanitized focus body inside <body> (sanitizer still applied)", () => {
    expect(out).toContain('<body><!--sanitized--><article class="focus-document"');
    expect(out).toContain("<h1>Should focus ship a private render-core first?</h1>");
  });

  it("defaults the theme id to entropic and links instead of inlining when asked", () => {
    const linked = renderHtml(doc, hooks, {
      stylesheetHref: "/css/entropic.css",
    });
    expect(linked).toContain('data-st-theme="entropic"');
    expect(linked).toContain('<link rel="stylesheet" href="/css/entropic.css">');
    expect(linked).not.toContain("data-focus-theme-tokens");
  });

  it("can omit the component stylesheet when the host owns it", () => {
    const noComponent = renderHtml(doc, hooks, {
      inlineCss: tokenCss,
      includeComponentCss: false,
    });
    expect(noComponent).not.toContain("data-focus-component-css");
    expect(noComponent).toContain("data-focus-theme-tokens");
  });
});
