import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSkillSource } from '../../format/parser.js';
import type { Skill, SkillToolHandler } from '../../types/skill.js';

export function readFoundationSkillSource(
  moduleUrl: string,
  bundleName: string,
): string {
  const here = dirname(fileURLToPath(moduleUrl));
  const candidates = [
    join(here, 'SKILL.md'),
    join(
      process.cwd(),
      'packages',
      'skills',
      'src',
      'bundles',
      'foundation',
      bundleName,
      'SKILL.md',
    ),
    join(
      process.cwd(),
      '..',
      'packages',
      'skills',
      'src',
      'bundles',
      'foundation',
      bundleName,
      'SKILL.md',
    ),
    join(
      process.cwd(),
      'packages',
      'skills',
      'dist',
      'bundles',
      'foundation',
      bundleName,
      'SKILL.md',
    ),
    join(
      process.cwd(),
      '..',
      'packages',
      'skills',
      'dist',
      'bundles',
      'foundation',
      bundleName,
      'SKILL.md',
    ),
  ];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function loadFoundationSkill(
  moduleUrl: string,
  bundleName: string,
  handlers: Readonly<Record<string, SkillToolHandler>>,
): Skill {
  const source = readFoundationSkillSource(moduleUrl, bundleName);
  const parsed = parseSkillSource(source);
  return Object.freeze({
    metadata: parsed.metadata,
    tools: parsed.tools,
    body: parsed.body,
    handlers,
  });
}
