import { describe, it, expect } from 'vitest';
import {
  normalizeMarkdownLineEndings,
  normalizeUseCaseMarkdown,
  stripTrailingEmptyParagraph,
} from '../../src/lib/utils/markdown';

describe('markdown utils', () => {
  describe('normalizeMarkdownLineEndings', () => {
    it('normalizes Windows and legacy line endings to LF', () => {
      expect(normalizeMarkdownLineEndings('line1\r\nline2\rline3\nline4')).toBe(
        'line1\nline2\nline3\nline4',
      );
    });

    it('returns empty string for nullish values', () => {
      expect(normalizeMarkdownLineEndings(null)).toBe('');
      expect(normalizeMarkdownLineEndings(undefined)).toBe('');
    });
  });

  describe('normalizeUseCaseMarkdown', () => {
    it('keeps historical behavior (unicode bullets + paragraph spacing)', () => {
      const input = '• First item\r\n• Second item\r\nSingle line';
      expect(normalizeUseCaseMarkdown(input)).toBe('-  First item\n-  Second item\n\nSingle line');
    });

    it('is idempotent', () => {
      const once = normalizeUseCaseMarkdown('line 1\r\nline 2');
      const twice = normalizeUseCaseMarkdown(once);
      expect(twice).toBe(once);
    });
  });

  describe('stripTrailingEmptyParagraph', () => {
    it('removes trailing blank paragraph only after markdown lists', () => {
      expect(stripTrailingEmptyParagraph('- item\n\n')).toBe('- item');
      expect(stripTrailingEmptyParagraph('paragraph\n\n')).toBe('paragraph\n\n');
    });
  });
});
