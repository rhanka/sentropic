import type { Skill } from '../../../types/skill.js';
import { loadFoundationSkill } from '../load-skill.js';
import { planHandlers } from './handler.js';

export const planSkill: Skill = loadFoundationSkill(import.meta.url, planHandlers);
