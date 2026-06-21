/**
 * `@sentropic/focus/cli` — the headless read-only Focus CLI driver (Focus-M1 L3).
 *
 * Per SPEC_VOL_FOCUS §4b L3: the FIRST usable end-to-end dogfood. Reads a REAL track decision
 * dossier (via the L2 `/track` binding `readDecisionDossier`) and renders it READ-ONLY to one of
 * the three deterministic surfaces (terminal / MD / HTML — HTML mandatory). It is wired into the
 * `stp` umbrella CLI as the in-repo `focus` subcommand (the manifest stays cross-repo-only).
 *
 * This module exports the federated-subcommand shape `{ run, version }` so the `stp` composition
 * root can register it through the same typed contract the cross-repo federation loader uses. The
 * `run` resolves to a process exit code (0 = success; non-zero with a clear stderr message on error
 * — missing args, decision not found, contract mismatch). It is READ-ONLY: NO track write, NO new
 * track event (those are L4).
 *
 *   stp focus <decision-id> [--format terminal|md|html] [--workspace <ws>]
 *                           [--baseline-commit <sha>] [--events-path <path>]
 *
 * Defaults: `--events-path` = `.track/events.jsonl`, `--format` = `terminal`. `--workspace` is
 * required (a decision lives in a per-workspace canevas; there is no safe default).
 */

import { createRequire } from "node:module";

import { renderHtml, renderMd, renderTerminal } from "../index.js";
import type { HtmlRenderHooks } from "../index.js";
import {
  DecisionNotFoundError,
  TrackContractMismatchError,
  readDecisionDossier,
} from "../track/index.js";

/** The package version, read from the package manifest (single source of truth). */
const pkg = createRequire(import.meta.url)("../../package.json") as {
  version: string;
};

/** The `{ run, version }` contract surfaced to the `stp` subcommand registry. */
export const version: string = pkg.version;

/** The supported render formats. */
const FORMATS = ["terminal", "md", "html"] as const;
type Format = (typeof FORMATS)[number];

const DEFAULT_EVENTS_PATH = ".track/events.jsonl";
const DEFAULT_FORMAT: Format = "terminal";

/** The parsed CLI invocation (after `stp focus`). */
interface ParsedArgs {
  readonly decisionId: string;
  readonly format: Format;
  readonly workspace: string;
  readonly baselineCommit: string;
  readonly eventsPath: string;
}

/** A parse failure carrying the message to print on stderr (exit code 2 = usage error). */
class UsageError extends Error {}

const USAGE =
  "Usage: stp focus <decision-id> [--format terminal|md|html] " +
  "[--workspace <ws>] [--baseline-commit <sha>] [--events-path <path>]\n" +
  "Render a track decision dossier read-only. Defaults: --format terminal, " +
  `--events-path ${DEFAULT_EVENTS_PATH}. --workspace is required.`;

/** Read the single value that must follow a `--flag`, or fail with a usage error. */
const takeValue = (argv: readonly string[], i: number, flag: string): string => {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new UsageError(`Missing value for ${flag}.`);
  }
  return value;
};

/**
 * Parse the argv that follows `focus` (so `stp focus D1 --format md` → `['D1','--format','md']`).
 * Throws `UsageError` (with `--help` text) on a malformed invocation.
 */
const parseArgs = (argv: readonly string[]): ParsedArgs => {
  const positionals: string[] = [];
  let format: Format = DEFAULT_FORMAT;
  let workspace: string | undefined;
  let baselineCommit = "";
  let eventsPath = DEFAULT_EVENTS_PATH;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    switch (arg) {
      case "-h":
      case "--help":
        throw new UsageError(USAGE);
      case "--format": {
        const value = takeValue(argv, i, "--format");
        if (!FORMATS.includes(value as Format)) {
          throw new UsageError(
            `Unknown --format "${value}" (expected one of: ${FORMATS.join(", ")}).`,
          );
        }
        format = value as Format;
        i += 1;
        break;
      }
      case "--workspace":
        workspace = takeValue(argv, i, "--workspace");
        i += 1;
        break;
      case "--baseline-commit":
        baselineCommit = takeValue(argv, i, "--baseline-commit");
        i += 1;
        break;
      case "--events-path":
        eventsPath = takeValue(argv, i, "--events-path");
        i += 1;
        break;
      default:
        if (arg.startsWith("--")) {
          throw new UsageError(`Unknown option "${arg}".\n${USAGE}`);
        }
        positionals.push(arg);
        break;
    }
  }

  if (positionals.length === 0) {
    throw new UsageError(`Missing <decision-id>.\n${USAGE}`);
  }
  if (positionals.length > 1) {
    throw new UsageError(
      `Expected exactly one <decision-id>, got ${positionals.length}.\n${USAGE}`,
    );
  }
  if (workspace === undefined || workspace.trim() === "") {
    throw new UsageError(`Missing --workspace (required).\n${USAGE}`);
  }

  return {
    decisionId: positionals[0] as string,
    format,
    workspace,
    baselineCommit,
    eventsPath,
  };
};

/**
 * IO sinks for {@link run}. Defaults wire `process.stdout`/`process.stderr` so the CLI is testable
 * without capturing the global streams (the federation loader uses the same injectable-deps style).
 */
export interface FocusCliDeps {
  /** Where rendered output goes (default: stdout). */
  readonly out?: (text: string) => void;
  /** Where error messages go (default: stderr). */
  readonly error?: (text: string) => void;
}

/**
 * Default render hooks for the headless CLI. The HTML surface needs a markdown converter + a
 * sanitizer; the headless dogfood does NOT bundle `marked`/DOMPurify (M0 injection rule), so the
 * default emits prose markdown inside a `<pre>` and is a no-op sanitizer — hosts that want rich
 * HTML inject their own hooks. The MD/terminal surfaces never touch these.
 */
const defaultHtmlHooks: HtmlRenderHooks = {
  renderMarkdown: (md) =>
    `<pre class="focus-md-raw">${md
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</pre>`,
  sanitizeHtml: (html) => html,
};

/**
 * Run the read-only Focus CLI. Returns a process exit code:
 *   0 — rendered successfully;
 *   2 — usage error (bad/missing args; also `--help`);
 *   3 — the decision was not found in the read log;
 *   4 — the installed `@sentropic/track/read` contract major is incompatible;
 *   1 — any other read/render failure.
 *
 * READ-ONLY: it never writes a track event. The `readAt` timestamp is captured here (the CLI is the
 * clock boundary; the L2 binding itself is clockless).
 */
export const run = async (
  argv: readonly string[],
  deps: FocusCliDeps = {},
): Promise<number> => {
  const out = deps.out ?? ((text: string) => process.stdout.write(text));
  const error = deps.error ?? ((text: string) => process.stderr.write(`${text}\n`));

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      error(err.message);
      return 2;
    }
    throw err;
  }

  try {
    const doc = readDecisionDossier(
      parsed.eventsPath,
      {
        workspace: parsed.workspace,
        baselineCommit: parsed.baselineCommit,
        decisionId: parsed.decisionId,
      },
      new Date().toISOString(),
    );

    switch (parsed.format) {
      case "terminal":
        out(renderTerminal(doc));
        break;
      case "md":
        out(renderMd(doc));
        break;
      case "html":
        out(renderHtml(doc, defaultHtmlHooks));
        break;
    }
    return 0;
  } catch (err) {
    if (err instanceof DecisionNotFoundError) {
      error(err.message);
      return 3;
    }
    if (err instanceof TrackContractMismatchError) {
      error(err.message);
      return 4;
    }
    error(`focus: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
};
