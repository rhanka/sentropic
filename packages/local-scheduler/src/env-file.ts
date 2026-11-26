import { readFileSync } from 'node:fs';
import type { LocalTaskSpecV1 } from './contract-types.js';
import { resolveSchedulerEnvFilePath } from './state-dir.js';

export interface LocalTaskKillSwitchMatchV1 {
  readonly scope: 'global' | 'task' | 'alias';
  readonly name: string;
}

const KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Parses systemd EnvironmentFile= syntax without shell expansion. */
export function parseSchedulerEnvFile(text: string): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!KEY_REGEX.test(key)) continue;
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/** Reads and parses the scheduler environment file, returning null when absent or unreadable. */
export function readSchedulerEnvFile(envFilePath?: string): Readonly<Record<string, string>> | null {
  const target = envFilePath ?? resolveSchedulerEnvFilePath();
  try {
    return parseSchedulerEnvFile(readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
}

function isTruthyKillSwitchValue(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized !== '' && normalized !== '0' && normalized !== 'false';
}

export function canonicalTaskKillSwitchVar(taskId: string): string {
  return `SENTROPIC_TASK_${taskId.toUpperCase().replace(/-/g, '_')}_OFF`;
}

/** Evaluates global, per-task canonical, and consumer-alias kill-switches in priority order. */
export function evaluateKillSwitch(
  env: Readonly<Record<string, string | undefined>>,
  spec: Pick<LocalTaskSpecV1, 'taskId' | 'killSwitchEnv'>,
): LocalTaskKillSwitchMatchV1 | null {
  const globalVar = 'SENTROPIC_LOCAL_SCHEDULER_OFF';
  if (isTruthyKillSwitchValue(env[globalVar])) return { scope: 'global', name: globalVar };

  const taskVar = canonicalTaskKillSwitchVar(spec.taskId);
  if (isTruthyKillSwitchValue(env[taskVar])) return { scope: 'task', name: taskVar };

  if (spec.killSwitchEnv && isTruthyKillSwitchValue(env[spec.killSwitchEnv])) {
    return { scope: 'alias', name: spec.killSwitchEnv };
  }
  return null;
}

export function isTaskKillSwitchActive(
  env: Readonly<Record<string, string | undefined>>,
  spec: Pick<LocalTaskSpecV1, 'taskId' | 'killSwitchEnv'>,
): boolean {
  return evaluateKillSwitch(env, spec) !== null;
}
