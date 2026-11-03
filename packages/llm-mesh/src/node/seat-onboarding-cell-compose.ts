//
// Stage-2 cell-side composition: map seat-storage auth names to cell
// destinations (§3.2), compose the claude `.claude.json` as its single
// writer, and resolve receipt paths. Internal module: not exported from the
// package entry points.

import { join, relative, resolve } from 'node:path';

import type { SeatCellConfigDirs } from './seat-onboarding-types.js';
import { fail, isRecord, withinRoot } from './seat-stage-write.js';

/** Map a seat-storage auth name to its cell destination (§3.2). */
export function authCellDest(name: string, cellHome: string, configDirs: SeatCellConfigDirs): string {
  if (name.startsWith('.claude/')) return join(configDirs.claudeConfigDir, name.slice('.claude/'.length));
  if (name === '.claude.json') return join(configDirs.claudeConfigDir, '.claude.json');
  if (name.startsWith('.codex/')) return join(configDirs.codexHome, name.slice('.codex/'.length));
  if (name.startsWith('.config/')) return join(configDirs.xdgConfigHome, name.slice('.config/'.length));
  return join(cellHome, name);
}

/** Receipt path relative to the owning cell root (names only, §3.6). */
export function receiptRelPath(path: string, cellHome: string, configDirs: SeatCellConfigDirs): string {
  if (withinRoot(cellHome, path)) return relative(resolve(cellHome), resolve(path));
  for (const dir of Object.values(configDirs)) {
    if (withinRoot(dir, path)) return relative(resolve(dir), resolve(path));
  }
  return resolve(path);
}

const CLAUDE_SINGLE_WRITER_KEYS = ['projects', 'hasCompletedOnboarding', 'oauthAccount'];

/** Compose the cell `.claude.json`: auth projection + onboarding projection + trust synthesis + MCP config merged last. */
export function composeClaudeJson(
  authBytes: Uint8Array,
  onboardingBytes: Uint8Array,
  workspaceDir: string,
  cellSynthesis: readonly string[],
  claudeMcpConfig: Record<string, unknown> | undefined,
): string {
  let authObj: Record<string, unknown>;
  let onboardObj: Record<string, unknown>;
  try {
    authObj = JSON.parse(new TextDecoder().decode(authBytes));
    onboardObj = JSON.parse(new TextDecoder().decode(onboardingBytes));
  } catch {
    fail('onboarding-shape-unverified', 'claude projection content is not JSON');
  }
  if (!isRecord(authObj) || !isRecord(onboardObj)) fail('onboarding-shape-unverified', 'claude projections must be objects');
  if (
    authObj['hasCompletedOnboarding'] !== undefined &&
    onboardObj['hasCompletedOnboarding'] !== undefined &&
    authObj['hasCompletedOnboarding'] !== onboardObj['hasCompletedOnboarding']
  ) {
    fail('onboarding-shape-unverified', 'auth and onboarding projections conflict on hasCompletedOnboarding');
  }
  const composed: Record<string, unknown> = {};
  if (authObj['oauthAccount'] !== undefined) composed['oauthAccount'] = authObj['oauthAccount'];
  const completed = onboardObj['hasCompletedOnboarding'] ?? authObj['hasCompletedOnboarding'];
  if (completed !== undefined) composed['hasCompletedOnboarding'] = completed;
  const lastVersion = onboardObj['lastOnboardingVersion'] ?? authObj['lastOnboardingVersion'];
  if (lastVersion !== undefined) composed['lastOnboardingVersion'] = lastVersion;
  if (cellSynthesis.includes('claude-workspace-trust')) {
    composed['projects'] = { [workspaceDir]: { hasTrustDialogAccepted: true } };
  }
  for (const [key, value] of Object.entries(claudeMcpConfig ?? {})) {
    if (CLAUDE_SINGLE_WRITER_KEYS.includes(key)) {
      fail('onboarding-shape-unverified', `claudeMcpConfig key has a single writer: ${key}`);
    }
    composed[key] = value;
  }
  return `${JSON.stringify(composed, null, 2)}\n`;
}
