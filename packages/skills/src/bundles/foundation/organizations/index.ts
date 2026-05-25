import type { Skill } from '../../../types/skill.js';
import { loadFoundationSkill } from '../load-skill.js';
import { organizationsHandlers } from './handler.js';

export const organizationsSkill: Skill = loadFoundationSkill(
  import.meta.url,
  'organizations',
  organizationsHandlers,
);
