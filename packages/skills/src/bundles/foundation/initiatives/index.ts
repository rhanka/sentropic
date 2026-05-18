import type { Skill } from '../../../types/skill.js';
import { loadFoundationSkill } from '../load-skill.js';
import { initiativesHandlers } from './handler.js';

export const initiativesSkill: Skill = loadFoundationSkill(
  import.meta.url,
  initiativesHandlers,
);
