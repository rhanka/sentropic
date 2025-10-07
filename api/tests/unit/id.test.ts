import { describe, it, expect } from 'vitest';
import { createId } from '../../src/utils/id';

describe('ID Utils', () => {
  describe('createId', () => {
    it('should generate a valid UUID', () => {
      const id = createId();
      
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(id).toMatch(uuidRegex);
    });

    it('should generate unique IDs', () => {
      const ids = new Set();
      const count = 1000;
      
      for (let i = 0; i < count; i++) {
        const id = createId();
        expect(ids.has(id)).toBe(false);
        ids.add(id);
      }
      
      expect(ids.size).toBe(count);
    });

    it('should generate string IDs', () => {
      const id = createId();
      expect(typeof id).toBe('string');
    });

    it('should generate IDs of correct length', () => {
      const id = createId();
      expect(id.length).toBe(36); // UUID v4 length
    });

    it('should not generate empty IDs', () => {
      const id = createId();
      expect(id).not.toBe('');
      expect(id.length).toBeGreaterThan(0);
    });

    it('should handle multiple calls without issues', () => {
      // This test ensures the function doesn't have side effects
      const ids = [];
      for (let i = 0; i < 10; i++) {
        ids.push(createId());
      }
      
      expect(ids).toHaveLength(10);
      expect(new Set(ids).size).toBe(10); // All unique
    });
  });
});
