import { describe, expect, it } from 'vitest';
import {
  renderMarkdownWithRefs,
  stripTrailingEmptyParagraph,
  type Reference,
} from '../../src/lib/utils/markdown';

describe('todo chat rendering utils', () => {
  it('renders checklist-style TODO markdown with chat-friendly styles', () => {
    const markdown = [
      '## TODO execution',
      '- [x] Create API endpoints',
      '- [ ] Wire chat tool orchestration',
      '- [ ] Render TODO card in chat',
    ].join('\n');

    const html = renderMarkdownWithRefs(markdown, [], {
      addListStyles: true,
      addHeadingStyles: true,
    });

    expect(html).toContain('TODO execution');
    expect(html).toContain('Create API endpoints');
    expect(html).toContain('Wire chat tool orchestration');
    expect(html).toContain('Render TODO card in chat');
    expect(html).toContain('list-disc');
    expect(html).toContain('text-xl font-semibold');
  });

  it('replaces TODO note reference markers with clickable anchors', () => {
    const markdown = '- [ ] Validate contract against [1] before merge';
    const references: Reference[] = [
      { title: 'TODO API contract', url: 'https://example.com/todo-contract' },
    ];

    const html = renderMarkdownWithRefs(markdown, references);

    expect(html).toContain('href="#ref-1"');
    expect(html).toContain('TODO API contract');
    expect(html).toContain('Validate contract against');
  });

  it('removes trailing blank paragraph after TODO checklist content', () => {
    expect(stripTrailingEmptyParagraph('- [x] Done item\n\n')).toBe(
      '- [x] Done item',
    );
  });
});
