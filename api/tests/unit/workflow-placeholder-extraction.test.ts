import { describe, expect, it } from 'vitest';
import {
  extractPlaceholdersFromText,
  extractWorkflowPlaceholdersBySection,
  extractWorkflowSectionPlaceholders,
} from '../../src/services/todo-runtime';

describe('workflow placeholder extraction', () => {
  it('extracts unique placeholders from text payload', () => {
    const placeholders = extractPlaceholdersFromText(
      'Use {{organization_name}} with {{ folder_id }} and {{organization_name}} in plan {{plan.slug}}',
    );
    expect(placeholders).toEqual(['organization_name', 'folder_id', 'plan.slug']);
  });

  it('extracts placeholders recursively from section payload', () => {
    const section = extractWorkflowSectionPlaceholders('task.prompt', {
      title: 'Generate {{usecase_name}}',
      body: ['Target {{organization_name}}', { note: 'Matrix {{matrix_id}}' }],
      metadata: {
        untouched: 12,
      },
    });

    expect(section.sectionKey).toBe('task.prompt');
    expect(section.placeholders).toEqual(['usecase_name', 'organization_name', 'matrix_id']);
  });

  it('extracts section-scoped placeholders for save/update flow', () => {
    const sections = extractWorkflowPlaceholdersBySection([
      {
        sectionKey: 'workflow.description',
        value: 'Describe {{organization_name}} goals',
      },
      {
        sectionKey: 'task.summary',
        value: {
          prompt: 'Summarize {{usecase_name}} for {{folder_name}}',
        },
      },
      {
        sectionKey: 'task.no_placeholders',
        value: 'No placeholders here',
      },
    ]);

    expect(sections).toEqual([
      {
        sectionKey: 'workflow.description',
        placeholders: ['organization_name'],
      },
      {
        sectionKey: 'task.summary',
        placeholders: ['usecase_name', 'folder_name'],
      },
      {
        sectionKey: 'task.no_placeholders',
        placeholders: [],
      },
    ]);
  });
});
