import { describe, expect, it } from 'vitest';
import {
  createDefaultRefLink,
  normalizeMarkdownLineEndings,
  normalizeUseCaseMarkdown,
  renderMarkdownWithRefs,
  stripTrailingEmptyParagraph,
  type MarkdownToHtmlFn,
  type Reference,
  type RenderMarkdownOptions,
} from '../src/utils/markdown-refs.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal markdown-to-HTML shim used in unit tests that do NOT need the full
 * marked rendering pipeline. Wraps the text in a <p> tag so we can assert on
 * HTML structure without importing a real markdown lib.
 */
const simpleRenderer: MarkdownToHtmlFn = (src) => `<p>${src}</p>`;

/**
 * Shim that renders very basic markdown constructs used in tests:
 * - **bold** → <strong>bold</strong>
 * - `- item` lines → <ul><li>item</li></ul>
 * - ## heading → <h2>heading</h2>
 * - plain text → <p>text</p>
 *
 * This is deterministic and good enough for unit assertions without
 * an external runtime dependency in the test environment.
 */
const testRenderer: MarkdownToHtmlFn = (src) => {
  // Bullet list
  const listLines = src.split('\n').filter((l) => l.match(/^- /));
  if (listLines.length > 0 && src.split('\n').every((l) => l.match(/^- /) || l.trim() === '')) {
    const items = listLines.map((l) => `<li>${l.slice(2)}</li>`).join('');
    return `<ul>${items}</ul>`;
  }
  // H2 heading
  if (src.startsWith('## ')) {
    return `<h2>${src.slice(3)}</h2>`;
  }
  // Bold **text**
  const bolded = src.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return `<p>${bolded}</p>`;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REFS: Reference[] = [
  { title: 'First source', url: 'https://example.com/1' },
  { title: 'Second source', url: 'https://example.com/2' },
  { title: 'Third source', url: 'https://example.com/3' },
];

// ---------------------------------------------------------------------------
// normalizeMarkdownLineEndings
// ---------------------------------------------------------------------------

describe('normalizeMarkdownLineEndings', () => {
  it('should convert CRLF to LF', () => {
    expect(normalizeMarkdownLineEndings('a\r\nb')).toBe('a\nb');
  });

  it('should convert standalone CR to LF', () => {
    expect(normalizeMarkdownLineEndings('a\rb')).toBe('a\nb');
  });

  it('should leave LF-only text unchanged', () => {
    expect(normalizeMarkdownLineEndings('a\nb')).toBe('a\nb');
  });

  it('should return empty string for null', () => {
    expect(normalizeMarkdownLineEndings(null)).toBe('');
  });

  it('should return empty string for undefined', () => {
    expect(normalizeMarkdownLineEndings(undefined)).toBe('');
  });

  it('should coerce non-string to string', () => {
    expect(normalizeMarkdownLineEndings(42)).toBe('42');
  });
});

// ---------------------------------------------------------------------------
// normalizeUseCaseMarkdown
// ---------------------------------------------------------------------------

describe('normalizeUseCaseMarkdown', () => {
  it('should return empty string for null', () => {
    expect(normalizeUseCaseMarkdown(null)).toBe('');
  });

  it('should return empty string for undefined', () => {
    expect(normalizeUseCaseMarkdown(undefined)).toBe('');
  });

  it('should convert unicode bullets to markdown dashes', () => {
    // The regex eats the bullet char only; any trailing space in the source remains.
    // '• item' → '- ' + ' item' = '-  item' (double space before text).
    // This matches the app implementation and is valid markdown (extra space is ignored).
    const result = normalizeUseCaseMarkdown('• item one\n• item two');
    expect(result).toBe('-  item one\n-  item two');
  });

  it('should add blank lines between adjacent paragraphs', () => {
    const result = normalizeUseCaseMarkdown('first paragraph\nsecond paragraph');
    expect(result).toBe('first paragraph\n\nsecond paragraph');
  });

  it('should be idempotent on already-normalised input', () => {
    const input = 'para one\n\npara two';
    expect(normalizeUseCaseMarkdown(input)).toBe(normalizeUseCaseMarkdown(normalizeUseCaseMarkdown(input)));
  });

  it('should convert an array of strings to a markdown bullet list', () => {
    const result = normalizeUseCaseMarkdown(['alpha', 'beta', 'gamma']);
    expect(result).toBe('- alpha\n- beta\n- gamma');
  });

  it('should skip empty array items', () => {
    const result = normalizeUseCaseMarkdown(['alpha', '', '  ', 'gamma']);
    expect(result).toBe('- alpha\n- gamma');
  });
});

// ---------------------------------------------------------------------------
// stripTrailingEmptyParagraph
// ---------------------------------------------------------------------------

describe('stripTrailingEmptyParagraph', () => {
  it('should return empty string for falsy input', () => {
    expect(stripTrailingEmptyParagraph(null)).toBe('');
    expect(stripTrailingEmptyParagraph(undefined)).toBe('');
    expect(stripTrailingEmptyParagraph('')).toBe('');
  });

  it('should return text unchanged when there is no trailing empty line', () => {
    const text = 'hello world';
    expect(stripTrailingEmptyParagraph(text)).toBe(text);
  });

  it('should strip trailing blank lines after a list item', () => {
    const text = '- item one\n- item two\n\n';
    const result = stripTrailingEmptyParagraph(text);
    expect(result.endsWith('\n\n')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createDefaultRefLink
// ---------------------------------------------------------------------------

describe('createDefaultRefLink', () => {
  it('should produce an anchor with href="#ref-N"', () => {
    const html = createDefaultRefLink('1', REFS[0]!);
    expect(html).toContain('href="#ref-1"');
  });

  it('should include the citation number in visible text', () => {
    const html = createDefaultRefLink('2', REFS[1]!);
    expect(html).toContain('[2]');
  });

  it('should include text-blue-600 class', () => {
    const html = createDefaultRefLink('1', REFS[0]!);
    expect(html).toContain('text-blue-600');
  });

  it('should include a smooth-scroll onclick handler', () => {
    const html = createDefaultRefLink('1', REFS[0]!);
    expect(html).toContain('scrollIntoView');
  });
});

// ---------------------------------------------------------------------------
// renderMarkdownWithRefs — basic rendering (with testRenderer injected)
// ---------------------------------------------------------------------------

describe('renderMarkdownWithRefs — basic rendering', () => {
  it('should return empty string for null', () => {
    expect(renderMarkdownWithRefs(null)).toBe('');
  });

  it('should return empty string for undefined', () => {
    expect(renderMarkdownWithRefs(undefined)).toBe('');
  });

  it('should return empty string for empty string', () => {
    expect(renderMarkdownWithRefs('')).toBe('');
  });

  it('should return rendered HTML from the injected markdownToHtml callback', () => {
    const html = renderMarkdownWithRefs('Hello world', [], {}, createDefaultRefLink, simpleRenderer);
    expect(html).toContain('<p>');
    expect(html).toContain('Hello world');
  });

  it('should render bold markdown via the injected renderer', () => {
    const html = renderMarkdownWithRefs('**bold text**', [], {}, createDefaultRefLink, testRenderer);
    expect(html).toContain('<strong>bold text</strong>');
  });

  it('should render a markdown list via the injected renderer', () => {
    const html = renderMarkdownWithRefs('- item one\n- item two', [], {}, createDefaultRefLink, testRenderer);
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>');
  });
});

// ---------------------------------------------------------------------------
// renderMarkdownWithRefs — ref substitution
// ---------------------------------------------------------------------------

describe('renderMarkdownWithRefs — ref substitution', () => {
  it('should substitute [1] with a ref link when a reference exists', () => {
    const html = renderMarkdownWithRefs('See [1] for details', REFS, {}, createDefaultRefLink, simpleRenderer);
    expect(html).toContain('href="#ref-1"');
    expect(html).toContain('[1]');
  });

  it('should substitute multiple refs in one string', () => {
    const html = renderMarkdownWithRefs('Sources: [1] and [2]', REFS, {}, createDefaultRefLink, simpleRenderer);
    expect(html).toContain('href="#ref-1"');
    expect(html).toContain('href="#ref-2"');
  });

  it('should leave [N] unchanged when N is out of range', () => {
    const html = renderMarkdownWithRefs('See [99] here', REFS, {}, createDefaultRefLink, simpleRenderer);
    // Out-of-range: placeholder is not created, so the raw token passes through the renderer
    expect(html).not.toContain('href="#ref-99"');
  });

  it('should not substitute refs when references array is empty', () => {
    const html = renderMarkdownWithRefs('See [1] here', [], {}, createDefaultRefLink, simpleRenderer);
    expect(html).not.toContain('href="#ref-1"');
  });

  it('should collapse pre-baked markdown reference links back to plain [N] then re-substitute', () => {
    // Simulate AI-baked link: [[1]](#ref-1 "First source")
    const html = renderMarkdownWithRefs(
      '[[1]](#ref-1 "First source") is interesting',
      REFS,
      {},
      createDefaultRefLink,
      simpleRenderer,
    );
    // After collapse + re-substitute, should contain a ref link
    expect(html).toContain('href="#ref-1"');
  });

  it('should work with default markdownToHtml fallback (no renderer injected)', () => {
    // Default fallback wraps in <p>, ref substitution still works
    const html = renderMarkdownWithRefs('See [1]', REFS);
    expect(html).toContain('href="#ref-1"');
  });
});

// ---------------------------------------------------------------------------
// renderMarkdownWithRefs — injected RefLinkRenderer
// ---------------------------------------------------------------------------

describe('renderMarkdownWithRefs — injected ref renderer', () => {
  it('should use the injected renderer instead of the default', () => {
    const customRenderer = (num: string, ref: Reference) =>
      `<a href="${ref.url}" target="_blank">[${num}]</a>`;

    const html = renderMarkdownWithRefs('See [1]', REFS, {}, customRenderer, simpleRenderer);
    expect(html).toContain(`href="${REFS[0]!.url}"`);
    expect(html).toContain('target="_blank"');
    // Default smooth-scroll anchor should NOT be present
    expect(html).not.toContain('scrollIntoView');
  });

  it('should pass the correct ref object to the renderer', () => {
    const captured: { num: string; ref: Reference }[] = [];
    const recorder = (num: string, ref: Reference): string => {
      captured.push({ num, ref });
      return `[${num}]`;
    };

    renderMarkdownWithRefs('Sources [1] and [3]', REFS, {}, recorder, simpleRenderer);
    expect(captured).toHaveLength(2);
    expect(captured[0]).toEqual({ num: '1', ref: REFS[0] });
    expect(captured[1]).toEqual({ num: '3', ref: REFS[2] });
  });
});

// ---------------------------------------------------------------------------
// renderMarkdownWithRefs — CSS option flags
// ---------------------------------------------------------------------------

describe('renderMarkdownWithRefs — options', () => {
  it('should inject list CSS classes when addListStyles is true', () => {
    const opts: RenderMarkdownOptions = { addListStyles: true };
    const html = renderMarkdownWithRefs('- item one\n- item two', [], opts, createDefaultRefLink, testRenderer);
    expect(html).toContain('list-disc');
    expect(html).toContain('space-y-2');
  });

  it('should NOT inject list CSS classes when addListStyles is false (default)', () => {
    const html = renderMarkdownWithRefs('- item one\n- item two', [], {}, createDefaultRefLink, testRenderer);
    expect(html).not.toContain('list-disc');
  });

  it('should inject heading CSS classes when addHeadingStyles is true', () => {
    const opts: RenderMarkdownOptions = { addHeadingStyles: true };
    const html = renderMarkdownWithRefs('## Section title', [], opts, createDefaultRefLink, testRenderer);
    expect(html).toContain('text-xl font-semibold');
  });

  it('should use custom listPadding when provided', () => {
    const opts: RenderMarkdownOptions = { addListStyles: true, listPadding: 2.5 };
    const html = renderMarkdownWithRefs('- item', [], opts, createDefaultRefLink, testRenderer);
    expect(html).toContain('padding-left:2.5rem');
  });
});
