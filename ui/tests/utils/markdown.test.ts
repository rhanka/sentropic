import { describe, it, expect } from 'vitest';
import {
  normalizeMarkdownLineEndings,
  normalizeUseCaseMarkdown,
  stripTrailingEmptyParagraph,
  renderMarkdownWithRefs,
  type Reference,
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

  describe('renderMarkdownWithRefs', () => {
    const refs: Reference[] = [
      { title: 'Foo>Bar', url: 'http://example.com' },
      { title: 'Baz', url: 'http://example2.com' },
    ];

    it('should render [1] and [2] as clickable links without title leak', () => {
      const html = renderMarkdownWithRefs('test [1] and [2] end', refs);
      // Links should be present
      expect(html).toContain('[1]');
      expect(html).toContain('[2]');
      expect(html).toContain('href="#ref-1"');
      expect(html).toContain('href="#ref-2"');
      // Title should NOT leak into visible text (only in title attribute)
      expect(html).not.toContain('>Foo');
      expect(html).not.toContain('>Baz');
      // Title should be in the title attribute (quotes escaped, > kept as-is in attr)
      expect(html).toContain('title="Foo>Bar"');
    });

    it('should not break when no references are provided', () => {
      const html = renderMarkdownWithRefs('text with [1] marker');
      expect(html).toContain('[1]');
      // Should not contain any reference link
      expect(html).not.toContain('href="#ref-1"');
    });

    it('should handle references with special HTML characters in title', () => {
      const specialRefs: Reference[] = [
        { title: 'Title "with" <quotes>', url: 'http://example.com' },
      ];
      const html = renderMarkdownWithRefs('see [1]', specialRefs);
      expect(html).toContain('href="#ref-1"');
      // Title with quotes should be escaped
      expect(html).toContain('title="Title &quot;with&quot;');
    });

    it('should leave [N] intact when N exceeds reference count', () => {
      const html = renderMarkdownWithRefs('see [1] and [5]', refs);
      expect(html).toContain('href="#ref-1"');
      // [5] should remain as plain text (no ref link)
      expect(html).toContain('[5]');
      expect(html).not.toContain('href="#ref-5"');
    });

    it('should strip pre-baked markdown reference links before rendering', () => {
      // Data stored in DB may already contain baked markdown links like:
      //   [\[1\]](#ref-1 "[1] Title")
      const input = 'text [\\[1\\]](#ref-1 "[1] Foo>Bar")[\\[2\\]](#ref-2 "[2] Baz") end';
      const html = renderMarkdownWithRefs(input, refs);
      // Should contain proper reference links
      expect(html).toContain('href="#ref-1"');
      expect(html).toContain('href="#ref-2"');
      // Title should NOT leak into visible text
      expect(html).not.toContain('>Foo');
      expect(html).not.toContain('>Baz');
      // Should not contain remnants of the old baked title text
      expect(html).not.toContain('Foo>Bar">[');
    });

    it('should strip pre-baked markdown reference links without title', () => {
      const input = 'see [\\[1\\]](#ref-1) here';
      const html = renderMarkdownWithRefs(input, refs);
      expect(html).toContain('href="#ref-1"');
      expect(html).toContain('[1]');
    });

    it('should strip pre-baked links with unescaped brackets', () => {
      const input = 'see [[1]](#ref-1 "[1] Title") here';
      const html = renderMarkdownWithRefs(input, refs);
      expect(html).toContain('href="#ref-1"');
      expect(html).not.toContain('Title');
    });
  });
});
