import type { Skill } from '../../../types/skill.js';
import { loadFoundationSkill } from '../load-skill.js';
import { productsHandlers } from './handler.js';

export const productsSkill: Skill = loadFoundationSkill(
  import.meta.url,
  'products',
  productsHandlers,
);
