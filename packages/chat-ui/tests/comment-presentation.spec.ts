import { describe, expect, it } from 'vitest';
import { getInitials, isSameDay } from '../src/comments/index.js';

describe('comment presentation', () => {
  describe('getInitials', () => {
    it('should extract initials from a full name', () => {
      expect(getInitials('John Doe')).toBe('JD');
    });

    it('should return first letter for single name', () => {
      expect(getInitials('Alice')).toBe('A');
    });

    it('should return ? for empty string', () => {
      expect(getInitials('')).toBe('?');
    });
  });

  describe('isSameDay', () => {
    it('should return true for same day Date objects', () => {
      const d1 = new Date('2026-06-05T10:00:00Z');
      const d2 = new Date('2026-06-05T22:00:00Z');
      expect(isSameDay(d1, d2)).toBe(true);
    });

    it('should return false for different days', () => {
      const d1 = new Date('2026-06-05T10:00:00Z');
      const d2 = new Date('2026-06-06T10:00:00Z');
      expect(isSameDay(d1, d2)).toBe(false);
    });
  });

});
