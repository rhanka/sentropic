/**
 * Unit specs for the `/track` read binding (Focus-M1 L2).
 *
 * Reads a REAL `@sentropic/track` event log (`tests/.track/events.jsonl`) through a `TrackReader`
 * and asserts the binding maps a real `canevas(workspace, { baselineCommit, decisionId }).dossier`
 * + `amendmentTrace(decisionId)` into a concrete `DecisionDossierDocument` with the CORRECTED
 * shapes:
 *   - `DecisionDossierView = { id, title, workspace, outcome, dossier }` (no top-level comprehension);
 *   - `Outcome = 'pending'|'go'|'no-go'|'deferred'`;
 *   - `ComprehensionEvidence` NESTED under `dossier.artifacts[] (kind:'h2a-decision-dossier').comprehension[]`;
 *   - the anti-confused-deputy invariant: the comprehension `subject` (the NAMED attester) is NOT
 *     the channel principal that merely relayed the write;
 *   - `amendmentTrace` ordered by seq, machine origin never laundered.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DecisionNotFoundError,
  EXPECTED_TRACK_READ_MAJOR,
  readDecisionDossier,
  toDecisionDossierDocument,
} from "../src/track/index.js";
import { TrackReader } from "@sentropic/track/read";
import { renderHtml, renderMd, renderTerminal } from "../src/index.js";
import type { HtmlRenderHooks } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const eventsPath = join(here, ".track", "events.jsonl");
const DECISION_ID = "01JFOCUSDECISION00000000000";
const READ_AT = "2026-06-21T12:00:00.000Z";
const query = {
  workspace: "focus",
  baselineCommit: "deadbeefcafebabedeadbeefcafebabedeadbeef",
  decisionId: DECISION_ID,
};

const hooks: HtmlRenderHooks = {
  renderMarkdown: (md) => `<md>${md}</md>`,
  sanitizeHtml: (html) => `<!--sanitized-->${html}`,
};

describe("readDecisionDossier (real @sentropic/track/read binding)", () => {
  const doc = readDecisionDossier(eventsPath, query, READ_AT);

  it("binds against a contract whose major matches the expected one", () => {
    const reader = new TrackReader(eventsPath);
    const major = Number.parseInt(reader.contractVersion.split(".")[0] ?? "", 10);
    expect(major).toBe(EXPECTED_TRACK_READ_MAJOR);
  });

  it("maps a real DecisionDossierView into a concrete decision-dossier document", () => {
    expect(doc.ref).toBe(DECISION_ID);
    // subject is derived from the view.workspace (the corrected shape carries id/title/workspace).
    expect(doc.subject).toBe("focus");
    expect(doc.title).toBe("Should focus bind to @sentropic/track/read at L2?");
  });

  it("projects the dossier (context + qa + options + outcome) into typed FocusNodes", () => {
    const kinds = doc.sections.map((s) => s.kind);
    expect(kinds).toEqual([
      "prose", // context
      "question", // qa-comprehension
      "question", // qa-clock
      "optionSet", // options
      "outcome", // terminal outcome node
    ]);
    const outcome = doc.sections[doc.sections.length - 1];
    expect(outcome.kind).toBe("outcome");
    if (outcome.kind === "outcome") {
      expect(outcome.modality).toBe("decision");
      // Outcome 'go' → a GO statement (the corrected Outcome union maps to a statement).
      expect(outcome.statement).toContain("GO");
    }
  });

  it("maps the selected option to an 'accept' annotation and carries the recommendation rationale", () => {
    const optionSet = doc.sections.find((s) => s.kind === "optionSet");
    expect(optionSet?.kind).toBe("optionSet");
    if (optionSet?.kind === "optionSet") {
      const selected = optionSet.options.find(
        (o) => o.label === "Bind to the versioned /read subpath",
      );
      expect(selected?.annotation).toBe("accept");
      expect(selected?.annotationComment).toContain("versioned /read");
      const other = optionSet.options.find(
        (o) => o.label === "Bind to the non-versioned barrel",
      );
      expect(other?.annotation).toBe("none");
    }
  });

  it("carries comprehension evidence from the NESTED dossier artifact (not a top-level sibling)", () => {
    expect(doc.provenance.comprehensionEvidence).toBeDefined();
    expect(doc.provenance.comprehensionEvidence?.subject).toBe("architect");
    expect(doc.provenance.comprehensionEvidence?.dossierHash).toContain("sha256:");
    expect(doc.provenance.comprehensionEvidence?.signature).toBe(
      "sig:architect-attestation",
    );
  });

  it("upholds the anti-confused-deputy invariant: attester subject != channel relayer principal", () => {
    // The artifact arrived over a relay channel whose prov.principal is 'relay-gateway', but the
    // comprehension subject is the NAMED attester/decider 'architect'. The binding must surface the
    // attester, never launder the origin into the relayer.
    expect(doc.provenance.comprehensionEvidence?.subject).toBe("architect");
    expect(doc.provenance.comprehensionEvidence?.subject).not.toBe(
      "relay-gateway",
    );
  });

  it("carries the amendment trace ordered by seq (machine origin never laundered)", () => {
    // Three amendment events on the decision aggregate: decision.artifact-added (seq 2) and
    // decision.outcome (seq 3) are amendment-trace kinds (decision.created is NOT). Ordered by seq.
    expect(doc.amendmentTrace.length).toBeGreaterThanOrEqual(2);
    const summaries = doc.amendmentTrace.map((s) => s.summary);
    // The outcome step comes after the artifact-added step (seq ordering preserved).
    const artifactIdx = summaries.findIndex((s) => s.includes("artifact-added"));
    const outcomeIdx = summaries.findIndex((s) => s.includes("GO"));
    expect(artifactIdx).toBeGreaterThanOrEqual(0);
    expect(outcomeIdx).toBeGreaterThan(artifactIdx);
    // Every recorded step here is human-proposed (prov.proposed=false → origin 'human').
    for (const step of doc.amendmentTrace) {
      expect(step.author).toContain("(human)");
    }
  });

  it("is renderable on all three surfaces (terminal/md/html) from the real read", () => {
    const text = renderTerminal(doc);
    expect(text).toContain("Should focus bind to @sentropic/track/read at L2?");
    expect(text).toContain("Outcome [decision]:");

    const md = renderMd(doc);
    expect(md).toContain("# Should focus bind to @sentropic/track/read at L2?");

    const html = renderHtml(doc, hooks);
    expect(html.startsWith("<!--sanitized-->")).toBe(true);
    expect(html).toContain("<h1>Should focus bind to @sentropic/track/read at L2?</h1>");
  });

  it("throws DecisionNotFoundError for an unknown decision id", () => {
    expect(() =>
      readDecisionDossier(
        eventsPath,
        { ...query, decisionId: "01JNOSUCHDECISION0000000000" },
        READ_AT,
      ),
    ).toThrow(DecisionNotFoundError);
  });
});

describe("toDecisionDossierDocument (pure mapper over the real read types)", () => {
  it("maps an empty-artifact dossier without comprehension evidence", () => {
    const doc = toDecisionDossierDocument(
      {
        id: "01JBARE000000000000000000000",
        title: "Bare decision",
        workspace: "focus",
        outcome: "pending",
        dossier: { context: "no artifacts", options: [], qa: [] },
      },
      [],
      { source: "test", readAt: READ_AT, cursor: "count:0" },
    );
    expect(doc.provenance.comprehensionEvidence).toBeUndefined();
    expect(doc.amendmentTrace).toHaveLength(0);
    // context prose + terminal outcome node only.
    expect(doc.sections.map((s) => s.kind)).toEqual(["prose", "outcome"]);
  });
});
