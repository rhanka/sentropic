import { parseSkillSource } from '../../../format/parser.js';
import type { Skill } from '../../../types/skill.js';
import { readFoundationSkillSource } from '../load-skill.js';
import { webHandlers } from './handler.js';

function loadWebSkill(): Skill {
  const source = readFoundationSkillSource(import.meta.url, 'web');
  const parsed = parseSkillSource(source);
  return Object.freeze({
    metadata: parsed.metadata,
    tools: parsed.tools,
    body: parsed.body,
    handlers: webHandlers,
  });
}

export const webSkill: Skill = loadWebSkill();
