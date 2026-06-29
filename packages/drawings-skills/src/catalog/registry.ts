import type { DrawingFormatId } from '../canvas/types';
import type { DrawingFormat, DrawingRegistry } from './types';

/** In-memory skill/tool/agent registry. One entry per format. */
export function createDrawingRegistry(): DrawingRegistry {
  const map = new Map<DrawingFormatId, DrawingFormat>();
  return {
    register(format) {
      if (map.has(format.id)) throw new Error(`Format "${format.id}" already registered`);
      map.set(format.id, format);
    },
    list: () => [...map.values()],
    get: (id) => map.get(id),
    getTool: (id) => map.get(id)?.tool,
    getSkill: (id) => map.get(id)?.skill,
  };
}
