import type { Skill } from '../../../types/skill.js';
import { loadFoundationSkill } from '../load-skill.js';
import { matrixHandlers } from './handler.js';

export const matrixSkill: Skill = loadFoundationSkill(
  import.meta.url,
  'matrix',
  matrixHandlers,
);
