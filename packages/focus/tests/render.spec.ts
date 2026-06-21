/**
 * Unit specs for the FocusSnapshot render-core (Focus-M1 L1).
 *
 * Asserts: the fixture maps to a `DecisionDossierDocument`; terminal/MD/HTML render the
 * structure; the amendment trace renders on all three; affordances appear as DISABLED metadata;
 * diagrams fall back to a fenced/`<pre>`/text block (no diagram adapter); markdown is injected
 * (MD passthrough, HTML via the host hook) and HTML is sanitized via the host hook.
 */

import { describe, expect, it } from "vitest";

import {
  renderHtml,
  renderMd,
  renderTerminal,
  toDecisionDossierDocument,
} from "../src/index.js";
import type { HtmlRenderHooks } from "../src/index.js";
import { decisionDossierFixture } from "./fixture.data.js";

const doc = toDecisionDossierDocument(decisionDossierFixture);

// A trivial host markdown hook (NOT marked — proves injection). Wraps content in a marker.
const hooks: HtmlRenderHooks = {
  renderMarkdown: (md) => `<md>${md}</md>`,
  sanitizeHtml: (html) => `<!--sanitized-->${html}`,
};

describe("toDecisionDossierDocument", () => {
  it("maps the fixture into a concrete decision-dossier document", () => {
    expect(doc.ref).toBe("decision:focus-render-core");
    expect(doc.subject).toBe("Focus-M1 L1 render-core packaging");
    expect(doc.hash).toBe("sha256:abc123");
    expect(doc.cursor).toBe("v7");
  });

  it("projects dossier blocks into typed FocusNodes plus a terminal outcome node", () => {
    const kinds = doc.sections.map((s) => s.kind);
    expect(kinds).toEqual([
      "prose",
      "question",
      "optionSet",
      "diagram",
      "outcome",
    ]);
    const outcome = doc.sections[doc.sections.length - 1];
    expect(outcome.kind).toBe("outcome");
    if (outcome.kind === "outcome") {
      expect(outcome.modality).toBe("decision");
    }
  });

  it("gives every node a stable id and a targetRef", () => {
    for (const node of doc.sections) {
      expect(node.id.length).toBeGreaterThan(0);
      expect(node.targetRef.length).toBeGreaterThan(0);
    }
  });

  it("carries comprehension evidence verbatim (subject/hash/sig intact)", () => {
    expect(doc.provenance.comprehensionEvidence).toEqual({
      subject: "Focus-M1 L1 render-core packaging",
      dossierHash: "sha256:abc123",
      signature: "sig:deadbeef",
    });
  });

  it("carries the amendment trace at the document level", () => {
    expect(doc.amendmentTrace).toHaveLength(2);
    expect(doc.amendmentTrace[0]?.author).toBe("owner");
  });

  it("projects generic affordances as DISABLED snapshot metadata", () => {
    expect(doc.interactions).toHaveLength(2);
    for (const a of doc.interactions) {
      expect(a.enabled).toBe(false);
    }
    expect(doc.interactions.map((a) => a.name)).toContain("ratifyOutcome");
  });
});

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
