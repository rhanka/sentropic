// @sentropic/llm-mesh/node/claude-code-cli-probe.ts
//
// Pure validation helpers for probing `claude --help` declared options and
// verifying positive CLI support for `--system-prompt-file`.

/** Mandatory confinement flags: every run must declare these options. */
export const CONFINEMENT_CLAUDE_CODE_FLAGS = [
  '--tools',
  '--strict-mcp-config',
  '--no-session-persistence',
] as const;

/** Mandatory headless invocation flags checked alongside `-p` and `stream-json`. */
export const REQUIRED_CLAUDE_CODE_FLAGS = [
  '--verbose',
  '--output-format',
  '--model',
  '--effort',
] as const;

export const HEADLESS_PRINT_FLAG = '-p';
export const OUTPUT_FORMAT_FLAG = '--output-format';
export const STREAM_JSON_FORMAT = 'stream-json';
export const SYSTEM_PROMPT_FILE_FLAG = '--system-prompt-file';
export const PROBE_MISSING_SYSTEM_PROMPT_FILENAME = 'claude-probe-nonexistent-system-prompt.txt';

const HELP_OPTION_TOKEN = '(?:--[A-Za-z0-9][A-Za-z0-9-]*|-[A-Za-z])';
const HELP_OPTION_ARG = '(?:<[^>]+>|\\[[^\\]]+\\])';
const HELP_OPTION_LINE_RE = new RegExp(
  `^( {0,4})(${HELP_OPTION_TOKEN}(?:\\s*,\\s*${HELP_OPTION_TOKEN})*)`
  + `(?:(?:\\s+|=)${HELP_OPTION_ARG})*(?:(?:\\s{2,}|\\t)(.*)|\\s*)$`,
);
const HELP_OPTIONS_HEADER_RE = /^(?:Options|Flags):\s*$/i;
const HELP_SECTION_HEADER_RE = /^[A-Za-z][A-Za-z0-9 _-]*:\s*$/;

export interface ProbeCommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly oversized: boolean;
}

/**
 * Parse declared CLI options from `claude --help`, restricting to the
 * `Options:` section when present and matching only option declarations at
 * the start of a line (ignoring prose mentions and deeper wrapped lines).
 */
export const parseClaudeCodeHelpOptions = (help: string): Map<string, string> => {
  const lines = help.replace(/\r\n/g, '\n').split('\n');
  const optionsStart = lines.findIndex((line) => HELP_OPTIONS_HEADER_RE.test(line));
  const sectionLines = optionsStart >= 0 ? lines.slice(optionsStart + 1) : lines;
  const declared = new Map<string, string>();
  let currentFlags: string[] = [];
  let currentIndent = -1;
  for (const line of sectionLines) {
    if (optionsStart >= 0 && HELP_SECTION_HEADER_RE.test(line)) break;
    if (line.trim().length === 0) {
      currentFlags = [];
      currentIndent = -1;
      continue;
    }
    const optionMatch = HELP_OPTION_LINE_RE.exec(line);
    if (optionMatch) {
      currentIndent = optionMatch[1].length;
      currentFlags = optionMatch[2].split(',').map((flag) => flag.trim());
      const desc = (optionMatch[3] ?? '').trim();
      for (const flag of currentFlags) {
        const prev = declared.get(flag);
        declared.set(flag, prev ? `${prev} ${desc}`.trim() : desc);
      }
      continue;
    }
    const lineIndent = /^ */.exec(line)![0].length;
    if (currentFlags.length > 0 && lineIndent > currentIndent) {
      const text = line.trim();
      for (const flag of currentFlags) {
        const prev = declared.get(flag) ?? '';
        declared.set(flag, prev ? `${prev} ${text}` : text);
      }
    } else {
      currentFlags = [];
      currentIndent = -1;
    }
  }
  return declared;
};

export const hasHelpValueToken = (text: string, token: string): boolean => {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9_-])${escaped}(?:$|[^A-Za-z0-9_-])`).test(text);
};

export type ClaudeCodeHelpValidation =
  | { readonly ok: true; readonly declared: Map<string, string> }
  | { readonly ok: false; readonly message: string };

/** Validate mandatory confinement and invocation options strictly from `--help`. */
export const validateClaudeCodeHelp = (help: string): ClaudeCodeHelpValidation => {
  const declared = parseClaudeCodeHelpOptions(help);
  const missingConfinement = CONFINEMENT_CLAUDE_CODE_FLAGS.filter((flag) => !declared.has(flag));
  if (missingConfinement.length > 0) {
    return {
      ok: false,
      message: `claude CLI probe found a CLI missing confinement flags: ${missingConfinement.join(', ')}`,
    };
  }
  const missingRequired = REQUIRED_CLAUDE_CODE_FLAGS.filter((flag) => !declared.has(flag));
  if (missingRequired.length > 0) {
    return {
      ok: false,
      message: `claude CLI probe found a CLI missing required flags: ${missingRequired.join(', ')}`,
    };
  }
  if (!declared.has(HEADLESS_PRINT_FLAG)) {
    return {
      ok: false,
      message: `claude CLI probe found a CLI without headless print mode: ${HEADLESS_PRINT_FLAG}`,
    };
  }
  if (!hasHelpValueToken(declared.get(OUTPUT_FORMAT_FLAG) ?? '', STREAM_JSON_FORMAT)) {
    return {
      ok: false,
      message: `claude CLI probe found a CLI without ${STREAM_JSON_FORMAT} output: ${OUTPUT_FORMAT_FLAG}`,
    };
  }
  return { ok: true, declared };
};

/**
 * Positive evidence that the CLI parsed `--system-prompt-file <missingPath>` and
 * tried to open that file (not an unknown-option error, silent drop, or auth error).
 */
export const isPositiveSystemPromptFileEvidence = (
  result: ProbeCommandResult,
  missingPath: string,
): boolean => {
  if (result.oversized || result.exitCode === null || result.exitCode === 0) return false;
  const combined = `${result.stdout}\n${result.stderr}`;
  if (/unknown option|unrecognized option|invalid option/i.test(combined)) return false;
  if (!combined.includes(missingPath) && !combined.includes(PROBE_MISSING_SYSTEM_PROMPT_FILENAME)) {
    return false;
  }
  return /not found|no such file|enoent|does not exist|cannot (?:open|read)/i.test(combined);
};
