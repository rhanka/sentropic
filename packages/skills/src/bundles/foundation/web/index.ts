import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSkillSource } from '../../../format/parser.js';
import type { Skill } from '../../../types/skill.js';
import { webHandlers } from './handler.js';

function loadWebSkill(): Skill {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, 'SKILL.md'), 'utf8');
  const parsed = parseSkillSource(source);
  return Object.freeze({
    metadata: parsed.metadata,
    tools: parsed.tools,
    body: parsed.body,
    handlers: webHandlers,
  });
}

export const webSkill: Skill = loadWebSkill();
