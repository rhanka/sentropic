import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSkillSource } from '../../format/parser.js';
import type { Skill, SkillToolHandler } from '../../types/skill.js';

export function loadFoundationSkill(
  moduleUrl: string,
  handlers: Readonly<Record<string, SkillToolHandler>>,
): Skill {
  const here = dirname(fileURLToPath(moduleUrl));
  const source = readFileSync(join(here, 'SKILL.md'), 'utf8');
  const parsed = parseSkillSource(source);
  return Object.freeze({
    metadata: parsed.metadata,
    tools: parsed.tools,
    body: parsed.body,
    handlers,
  });
}
