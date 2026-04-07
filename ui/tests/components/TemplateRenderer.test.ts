import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Pure-function extractions from TemplateRenderer.svelte
// These mirror the component-internal helpers for unit testing without
// requiring Svelte component rendering (per project testing policy).
// ---------------------------------------------------------------------------

/** Traverse a nested object via dot-notation path (mirrors getNestedValue). */
function getFieldValue(obj: any, path: string): any {
  return path.split('.').reduce((acc: any, part: string) => acc?.[part], obj);
}

/** Return the short key (last segment) for i18n lookups / comment sections. */
function shortKey(key: string): string {
  const idx = key.lastIndexOf('.');
  return idx >= 0 ? key.slice(idx + 1) : key;
}

/** Determine whether a field should render based on its printOnly flag and the current isPrinting state. */
function shouldRenderField(field: { printOnly?: boolean }, isPrinting: boolean): boolean {
  if (field.printOnly && !isPrinting) return false;
  return true;
}

/** Collect all field descriptors from a template (flattened). */
function collectFields(template: any): any[] {
  if (!template?.tabs) return [];
  const fields: any[] = [];
  for (const tab of template.tabs) {
    for (const row of tab.rows ?? []) {
      if (row.main) {
        for (const f of row.main.fields ?? []) fields.push(f);
      }
      if (row.sidebar) {
        for (const f of row.sidebar.fields ?? []) fields.push(f);
      }
      for (const f of row.fields ?? []) fields.push(f);
    }
  }
  return fields;
}

/** Filter entity-loop fields from a template. */
function getEntityLoopFields(template: any): any[] {
  return collectFields(template).filter((f: any) => f.type === 'entity-loop');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TemplateRenderer pure logic', () => {
  describe('getFieldValue (dot-notation path access)', () => {
    const data = {
      name: 'Root Level',
      data: {
        executive_summary: {
          introduction: 'Hello world',
          analyse: 'Deep analysis',
          references: [{ title: 'Ref1', url: 'https://example.com' }],
        },
        nested: {
          deep: {
            value: 42,
          },
        },
      },
    };

    it('should access top-level keys', () => {
      expect(getFieldValue(data, 'name')).toBe('Root Level');
    });

    it('should traverse dot-notation paths', () => {
      expect(getFieldValue(data, 'data.executive_summary.introduction')).toBe('Hello world');
    });

    it('should traverse deeply nested paths', () => {
      expect(getFieldValue(data, 'data.nested.deep.value')).toBe(42);
    });

    it('should return undefined for missing intermediate keys', () => {
      expect(getFieldValue(data, 'data.nonexistent.field')).toBeUndefined();
    });

    it('should return undefined for missing leaf keys', () => {
      expect(getFieldValue(data, 'data.executive_summary.nonexistent')).toBeUndefined();
    });

    it('should handle null/undefined root gracefully', () => {
      expect(getFieldValue(null, 'some.path')).toBeUndefined();
      expect(getFieldValue(undefined, 'some.path')).toBeUndefined();
    });

    it('should return array values at path', () => {
      const refs = getFieldValue(data, 'data.executive_summary.references');
      expect(Array.isArray(refs)).toBe(true);
      expect(refs).toHaveLength(1);
      expect(refs[0].title).toBe('Ref1');
    });
  });

  describe('shortKey', () => {
    it('should return the last segment of a dot-path', () => {
      expect(shortKey('data.executive_summary.introduction')).toBe('introduction');
    });

    it('should return the full key when no dot is present', () => {
      expect(shortKey('name')).toBe('name');
    });

    it('should handle keys with multiple dots', () => {
      expect(shortKey('a.b.c.d')).toBe('d');
    });

    it('should handle empty string', () => {
      expect(shortKey('')).toBe('');
    });
  });

  describe('printOnly gating', () => {
    it('should render non-printOnly fields regardless of isPrinting', () => {
      expect(shouldRenderField({ printOnly: false }, false)).toBe(true);
      expect(shouldRenderField({ printOnly: false }, true)).toBe(true);
      expect(shouldRenderField({}, false)).toBe(true);
      expect(shouldRenderField({}, true)).toBe(true);
    });

    it('should NOT render printOnly fields when isPrinting is false', () => {
      expect(shouldRenderField({ printOnly: true }, false)).toBe(false);
    });

    it('should render printOnly fields when isPrinting is true', () => {
      expect(shouldRenderField({ printOnly: true }, true)).toBe(true);
    });
  });

  describe('entity-loop field detection', () => {
    const template = {
      tabs: [
        {
          key: 'detail',
          label: 'Detail',
          always: true,
          rows: [
            {
              fields: [
                { key: 'name', type: 'text' },
                {
                  key: 'initiatives',
                  type: 'entity-loop',
                  collection: 'initiatives',
                  templateRef: 'initiative',
                  printOnly: true,
                },
              ],
            },
            {
              main: {
                fields: [
                  { key: 'description', type: 'text' },
                ],
              },
              sidebar: {
                fields: [
                  { key: 'score_table', type: 'score' },
                ],
              },
            },
          ],
        },
      ],
    };

    it('should collect all fields from template rows (main, sidebar, direct)', () => {
      const fields = collectFields(template);
      expect(fields).toHaveLength(4);
      expect(fields.map((f: any) => f.key)).toEqual([
        'name',
        'initiatives',
        'description',
        'score_table',
      ]);
    });

    it('should filter entity-loop fields', () => {
      const entityLoops = getEntityLoopFields(template);
      expect(entityLoops).toHaveLength(1);
      expect(entityLoops[0].key).toBe('initiatives');
      expect(entityLoops[0].collection).toBe('initiatives');
      expect(entityLoops[0].templateRef).toBe('initiative');
    });

    it('should resolve collection items for entity-loop fields', () => {
      const collections = {
        initiatives: [
          { id: '1', name: 'Initiative A' },
          { id: '2', name: 'Initiative B' },
        ],
      };

      const entityLoops = getEntityLoopFields(template);
      const loopField = entityLoops[0];
      const items = collections[loopField.collection as keyof typeof collections] ?? [];
      expect(items).toHaveLength(2);
      expect(items[0].name).toBe('Initiative A');
    });

    it('should return empty array when collection is missing', () => {
      const entityLoops = getEntityLoopFields(template);
      const loopField = entityLoops[0];
      const collections: Record<string, any[]> = {};
      const items = collections[loopField.collection] ?? [];
      expect(items).toHaveLength(0);
    });
  });

  describe('component type field detection', () => {
    it('should identify component-type fields for slot rendering', () => {
      const template = {
        tabs: [
          {
            key: 'main',
            always: true,
            rows: [
              {
                fields: [
                  { key: 'scatter_plot', type: 'component' },
                  { key: 'cover_page', type: 'component', printOnly: true },
                  { key: 'description', type: 'text' },
                ],
              },
            ],
          },
        ],
      };

      const fields = collectFields(template);
      const componentFields = fields.filter((f: any) => f.type === 'component');
      expect(componentFields).toHaveLength(2);
      expect(componentFields[0].key).toBe('scatter_plot');
      expect(componentFields[1].key).toBe('cover_page');
      expect(componentFields[1].printOnly).toBe(true);
    });
  });
});
