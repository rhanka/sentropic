import type { Skill } from '../../../types/skill.js';
import { loadFoundationSkill } from '../load-skill.js';
import { gateReviewHandlers } from './handler.js';

export const gateReviewSkill: Skill = loadFoundationSkill(
  import.meta.url,
  'gate_review',
  gateReviewHandlers,
);
