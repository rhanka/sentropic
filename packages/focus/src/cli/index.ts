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
 *                           [--ds] [--theme <theme-id>]
 *
 * Defaults: `--events-path` = `.track/events.jsonl`, `--format` = `terminal`. `--workspace` is
 * required (a decision lives in a per-workspace canevas; there is no safe default). `--ds` (and
 * `--theme <id>`, which implies `--ds`) wrap the `html` surface into a SELF-CONTAINED DS-themed
 * document by inlining `@sentropic/design-system-themes/css/<theme-id>.css` (resolved from
 * node_modules); they apply to `--format html` only and leave the default output unchanged.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { DEFAULT_FOCUS_THEME_ID, renderHtml, renderMd, renderTerminal } from "../index.js";
import type { FocusHtmlTheme, HtmlRenderHooks } from "../index.js";
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
  /** Wrap the html surface into a self-contained DS-themed document (html only). */
  readonly ds: boolean;
  /** DS theme id used when `ds` is set. */
  readonly themeId: string;
}

/** A parse failure carrying the message to print on stderr (exit code 2 = usage error). */
class UsageError extends Error {}

const USAGE =
  "Usage: stp focus <decision-id> [--format terminal|md|html] " +
  "[--workspace <ws>] [--baseline-commit <sha>] [--events-path <path>] " +
  "[--ds] [--theme <theme-id>]\n" +
  "Render a track decision dossier read-only. Defaults: --format terminal, " +
  `--events-path ${DEFAULT_EVENTS_PATH}. --workspace is required. --ds/--theme ` +
  `(default theme ${DEFAULT_FOCUS_THEME_ID}) DS-theme the html surface only.`;

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
  let ds = false;
  let themeId = DEFAULT_FOCUS_THEME_ID;

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
      case "--ds":
        ds = true;
        break;
      case "--theme":
        themeId = takeValue(argv, i, "--theme");
        ds = true;
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
  if (ds && format !== "html") {
    throw new UsageError(
      `--ds/--theme apply to --format html only (got --format ${format}).\n${USAGE}`,
    );
  }

  return {
    decisionId: positionals[0] as string,
    format,
    workspace,
    baselineCommit,
    eventsPath,
    ds,
    themeId,
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
  /**
   * Resolve the DS token CSS for a theme id (used by `--ds`/`--theme`). Defaults to resolving +
   * reading `@sentropic/design-system-themes/css/<themeId>.css` from node_modules; injectable so
   * tests need not have the DS package installed. Throws if the theme CSS cannot be resolved.
   */
  readonly resolveThemeCss?: (themeId: string) => string;
}

/**
 * Default DS-theme CSS resolver: resolve + read the published DS token sheet
 * (`@sentropic/design-system-themes/css/<themeId>.css`, pure `[data-st-theme]{ --st-* }` custom
 * properties) from node_modules. Throws if the package/theme is not installed.
 */
const defaultResolveThemeCss = (themeId: string): string => {
  const requireFromHere = createRequire(import.meta.url);
  const cssPath = requireFromHere.resolve(
    `@sentropic/design-system-themes/css/${themeId}.css`,
  );
  return readFileSync(cssPath, "utf8");
};

/**
 * Default render hooks for the headless CLI. Since F1 the HTML renderer ships a built-in `marked`
 * default, so the CLI no longer injects a raw-`<pre>` markdown hook — it OMITS `renderMarkdown` and
 * lets the default render REAL markdown (headings/bold/lists/code). `sanitizeHtml` stays a no-op: the
 * CLI reads owner-authored, trusted track dossiers locally; a host rendering untrusted content injects
 * its own sanitizer. The MD/terminal surfaces never touch these.
 */
const defaultHtmlHooks: HtmlRenderHooks = {
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
      case "html": {
        let theme: FocusHtmlTheme | undefined;
        if (parsed.ds) {
          const resolveThemeCss = deps.resolveThemeCss ?? defaultResolveThemeCss;
          let inlineCss: string;
          try {
            inlineCss = resolveThemeCss(parsed.themeId);
          } catch (e) {
            error(
              `focus: could not resolve DS theme CSS for "${parsed.themeId}" ` +
                `(is @sentropic/design-system-themes installed?): ` +
                `${e instanceof Error ? e.message : String(e)}`,
            );
            return 1;
          }
          theme = { themeId: parsed.themeId, inlineCss };
        }
        out(renderHtml(doc, defaultHtmlHooks, theme));
        break;
      }
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
