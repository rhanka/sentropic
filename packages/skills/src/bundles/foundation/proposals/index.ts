import type { Skill } from '../../../types/skill.js';
import { loadFoundationSkill } from '../load-skill.js';
import { proposalsHandlers } from './handler.js';

export const proposalsSkill: Skill = loadFoundationSkill(
  import.meta.url,
  'proposals',
  proposalsHandlers,
);
