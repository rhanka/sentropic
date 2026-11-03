//
// Pure capture-side and cell-side projections for the claude, muse and
// codex onboarding formats (L4). Same rule as seat-onboarding.ts: no home,
// keyring, network or provider access. Capture projects the allowlisted
// subset of a source file and re-serializes canonically; the cell renderer
// turns the transported intent into the cell config. Every refusal throws
// SeatOnboardingError (fail-closed).

import {
  CLAUDE_VERSION_PATTERN,
  CODEX_APPROVAL_POLICY_VALUES,
  MCP_SERVER_NAME_PATTERN,
  MUSE_TRUST_KNOWN_SCHEMA_VERSIONS,
  SeatOnboardingError,
} from './seat-onboarding.js';

/**
 * Version-pinned codex probe record (§4.3). The claim « a pre-trusted
 * project entry plus declared `mcp_servers` suppresses the first-use
 * approval prompt at the pinned codex version » is unverified: the codex
 * binary was not on PATH in the r1 pass. Until a version-pinned probe
 * confirms it, the typed blocker `codex-mcp-approval-unresolved` remains
 * the fallback and no approval prompt is ever pressed by the library.
 */
export const CODEX_TRUST_DIALOG_PROBE = {
  status: 'unverified' as const,
  fallbackBlocker: 'codex-mcp-approval-unresolved',
  detail: 'pre-trusted project + declared mcp_servers suppressing the first-use codex approval prompt is unverified at the pinned version',
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseJson = (text: string, what: string): Record<string, unknown> => {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new SeatOnboardingError('onboarding-shape-unverified', `${what} is not JSON`);
  }
  if (!isRecord(obj)) throw new SeatOnboardingError('onboarding-shape-unverified', `${what} must be an object`);
  return obj;
};

/**
 * Project an owner `.claude.json` (any size) to the two-field canonical
 * projection. `oauthAccount` is account-identifying and stays on the auth
 * path — it is never part of the projection.
 */
export function projectClaudeOnboarding(sourceText: string): string {
  const obj = parseJson(sourceText, 'claude source');
  if (obj['hasCompletedOnboarding'] !== true) {
    throw new SeatOnboardingError('onboarding-incomplete', 'source hasCompletedOnboarding is not true');
  }
  const version = obj['lastOnboardingVersion'];
  if (typeof version !== 'string' || !CLAUDE_VERSION_PATTERN.test(version)) {
    throw new SeatOnboardingError('onboarding-shape-unverified', 'lastOnboardingVersion must match x.y.z');
  }
  return JSON.stringify({ hasCompletedOnboarding: true, lastOnboardingVersion: version });
}

/** Project an owner muse `trust.json` to the schema_version-only canonical form. */
export function projectMuseTrust(sourceText: string): string {
  const obj = parseJson(sourceText, 'muse trust source');
  const schemaVersion = obj['schema_version'];
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || !MUSE_TRUST_KNOWN_SCHEMA_VERSIONS.includes(schemaVersion)) {
    throw new SeatOnboardingError('onboarding-shape-unverified', 'unknown muse schema_version');
  }
  return JSON.stringify({ schema_version: schemaVersion });
}

export interface CodexSeatIntent {
  approvalPolicy: string;
  mcpServerNames: string[];
}

/** Validate and canonicalize the custodian-supplied codex policy intent. No file is read. */
export function projectCodexIntent(intent: unknown): string {
  if (!isRecord(intent)) throw new SeatOnboardingError('onboarding-shape-unverified', 'codex intent must be an object');
  const extra = Object.keys(intent).find((k) => !['approvalPolicy', 'mcpServerNames'].includes(k));
  if (extra) throw new SeatOnboardingError('onboarding-unknown-field', `unknown codex intent field: ${extra}`);
  const policy = intent['approvalPolicy'];
  if (typeof policy !== 'string' || !CODEX_APPROVAL_POLICY_VALUES.includes(policy)) {
    throw new SeatOnboardingError('onboarding-shape-unverified', 'approvalPolicy is not in the closed per-version enum');
  }
  const names = intent['mcpServerNames'];
  if (!Array.isArray(names) || names.length === 0) {
    throw new SeatOnboardingError('onboarding-shape-unverified', 'mcpServerNames must be a non-empty array');
  }
  const seen = new Set<string>();
  for (const name of names) {
    if (typeof name !== 'string' || !MCP_SERVER_NAME_PATTERN.test(name) || seen.has(name)) {
      throw new SeatOnboardingError('onboarding-shape-unverified', 'malformed or duplicate mcpServerNames entry');
    }
    seen.add(name);
  }
  return JSON.stringify({ approvalPolicy: policy, mcpServerNames: names });
}

export interface CodexMcpServerSpec {
  name: string;
  command: string;
  args: readonly string[];
  defaultToolsApprovalMode?: 'approve';
}

/**
 * Render the cell codex `config.toml` from the transported intent, the cell
 * workspace and the harness-supplied server definitions. A server outside
 * the intent's `mcpServerNames` refuses: the harness cannot widen the
 * seat's approved server set at cell time.
 */
export function renderCodexSeatConfig(
  intentText: string,
  workspaceDir: string,
  options: { projectTrust: boolean; mcpServers?: readonly CodexMcpServerSpec[] },
): string {
  const intent = parseJson(intentText, 'codex intent');
  const policy = intent['approvalPolicy'];
  const names = intent['mcpServerNames'];
  if (typeof policy !== 'string' || !Array.isArray(names)) {
    throw new SeatOnboardingError('onboarding-shape-unverified', 'codex intent shape refused');
  }
  let out = `approval_policy = ${JSON.stringify(policy)}\n`;
  if (options.projectTrust) {
    out += `\n[projects.${JSON.stringify(workspaceDir)}]\ntrust_level = "trusted"\n`;
  }
  for (const server of options.mcpServers ?? []) {
    if (typeof server.name !== 'string' || !names.includes(server.name)) {
      throw new SeatOnboardingError('onboarding-shape-unverified', `MCP server outside the intent set: ${String(server.name)}`);
    }
    out += `\n[mcp_servers.${server.name}]\n`;
    out += `command = ${JSON.stringify(server.command)}\n`;
    out += `args = [${server.args.map((a) => JSON.stringify(a)).join(',')}]\n`;
    if (server.defaultToolsApprovalMode === 'approve') out += 'default_tools_approval_mode = "approve"\n';
  }
  return out;
}
