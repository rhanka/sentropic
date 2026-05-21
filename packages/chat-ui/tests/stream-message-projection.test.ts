import { describe, expect, it } from 'vitest';
import {
  buildTodoRuntimeChecklist,
  needsReasoningSectionBreak,
  summarizePreviewText,
} from '../src/state/streamMessageProjection.js';

describe('StreamMessage projection helpers', () => {
  it('inserts reasoning section breaks only before markdown section headings', () => {
    expect(needsReasoningSectionBreak('prior text', '**Next**')).toBe(true);
    expect(needsReasoningSectionBreak('prior text\n', '**Next**')).toBe(false);
    expect(needsReasoningSectionBreak('', '**Next**')).toBe(false);
    expect(needsReasoningSectionBreak('prior text', 'plain delta')).toBe(false);
  });

  it('projects todo runtime results into escaped markdown checklists', () => {
    const checklist = buildTodoRuntimeChecklist('plan', {
      todoRuntime: {
        todo: { title: 'Launch [SDK]' },
        tasks: [
          { id: 'a', title: 'Extract StreamMessage', status: 'done' },
          { id: 'b', title: 'Wire docs + tests', status: 'todo' },
        ],
      },
    });

    expect(checklist).toBe(
      [
        'Plan Launch [SDK]',
        '- [x] ~~Extract StreamMessage~~',
        '- [ ] Wire docs \\+ tests',
      ].join('\n'),
    );
  });

  it('keeps only the latest preview tail for collapsed history summaries', () => {
    const prefix = 'x'.repeat(40);
    const tail = 'y'.repeat(320);
    expect(summarizePreviewText(`${prefix}${tail}`)).toBe(tail);
  });
});
