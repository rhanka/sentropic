/**
 * Unit specs for the read-only Focus CLI driver (`@sentropic/focus/cli`, Focus-M1 L3).
 *
 * Runs the CLI `run([...])` end-to-end against the L2 `.track` fixture event log
 * (`tests/.track/events.jsonl`, decision `01JFOCUSDECISION00000000000`, workspace `focus`) for each
 * `--format` (terminal / md / html), asserting exit 0 + the captured stdout contains the decision
 * title + outcome. Also asserts the non-zero exit codes + clear stderr message on a missing
 * decision-id, an unknown decision, a missing --workspace, and an unknown --format. READ-ONLY: the
 * CLI never writes a track event (the fixture is unchanged between runs).
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { run } from "../src/cli/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const eventsPath = join(here, ".track", "events.jsonl");
const DECISION_ID = "01JFOCUSDECISION00000000000";
const TITLE = "Should focus bind to @sentropic/track/read at L2?";

/** Capture stdout + stderr into buffers so the CLI can be asserted without touching globals. */
function capture(): {
  out: string;
  err: string;
  deps: { out: (t: string) => void; error: (t: string) => void };
} {
  const sink = { out: "", err: "" };
  return {
    get out() {
      return sink.out;
    },
    get err() {
      return sink.err;
    },
    deps: {
      out: (t: string) => {
        sink.out += t;
      },
      error: (t: string) => {
        sink.err += `${t}\n`;
      },
    },
  };
}

const baseArgs = (format: string): string[] => [
  DECISION_ID,
  "--workspace",
  "focus",
  "--events-path",
  eventsPath,
  "--format",
  format,
];

describe("focus CLI — renders a real decision dossier read-only", () => {
  it("renders the terminal surface (exit 0, title + outcome in stdout)", async () => {
    const c = capture();
    const code = await run(baseArgs("terminal"), c.deps);
    expect(code).toBe(0);
    expect(c.err).toBe("");
    expect(c.out).toContain(TITLE);
    expect(c.out).toContain("Outcome [decision]:");
    expect(c.out).toContain("GO");
  });

  it("renders the md surface (exit 0, H1 title + outcome heading)", async () => {
    const c = capture();
    const code = await run(baseArgs("md"), c.deps);
    expect(code).toBe(0);
    expect(c.err).toBe("");
    expect(c.out).toContain(`# ${TITLE}`);
    expect(c.out).toContain("### Outcome (decision)");
    expect(c.out).toContain("GO");
  });

  it("renders the html surface (exit 0, article header + outcome section)", async () => {
    const c = capture();
    const code = await run(baseArgs("html"), c.deps);
    expect(code).toBe(0);
    expect(c.err).toBe("");
    expect(c.out).toContain(`<h1>${TITLE}</h1>`);
    expect(c.out).toContain('class="focus-outcome"');
    expect(c.out).toContain("GO");
  });

  it("defaults to the terminal format when --format is omitted", async () => {
    const c = capture();
    const code = await run(
      [DECISION_ID, "--workspace", "focus", "--events-path", eventsPath],
      c.deps,
    );
    expect(code).toBe(0);
    expect(c.out).toContain("Outcome [decision]:");
  });
});

describe("focus CLI — error handling (non-zero + clear stderr)", () => {
  it("exits 2 with a usage message when the <decision-id> is missing", async () => {
    const c = capture();
    const code = await run(["--workspace", "focus", "--events-path", eventsPath], c.deps);
    expect(code).toBe(2);
    expect(c.err).toContain("Missing <decision-id>");
    expect(c.out).toBe("");
  });

  it("exits 2 with a usage message when --workspace is missing", async () => {
    const c = capture();
    const code = await run([DECISION_ID, "--events-path", eventsPath], c.deps);
    expect(code).toBe(2);
    expect(c.err).toContain("Missing --workspace");
  });

  it("exits 2 with a usage message on an unknown --format", async () => {
    const c = capture();
    const code = await run(
      [DECISION_ID, "--workspace", "focus", "--events-path", eventsPath, "--format", "pdf"],
      c.deps,
    );
    expect(code).toBe(2);
    expect(c.err).toContain('Unknown --format "pdf"');
  });

  it("exits 3 with a not-found message on an unknown decision id", async () => {
    const c = capture();
    const code = await run(
      [
        "01JNOSUCHDECISION0000000000",
        "--workspace",
        "focus",
        "--events-path",
        eventsPath,
        "--format",
        "terminal",
      ],
      c.deps,
    );
    expect(code).toBe(3);
    expect(c.err).toContain("not found");
    expect(c.out).toBe("");
  });
});
