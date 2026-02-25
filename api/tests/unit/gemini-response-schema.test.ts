import { describe, expect, it } from 'vitest';

import { sanitizeGeminiResponseSchema } from '../../src/services/openai';

describe('sanitizeGeminiResponseSchema', () => {
  it('removes unsupported Gemini response schema keywords recursively', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        dossier: { type: 'string' },
        useCases: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              titre: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['titre', 'description'],
          },
        },
      },
      required: ['dossier', 'useCases'],
    } as Record<string, unknown>;

    const sanitized = sanitizeGeminiResponseSchema(schema);

    expect(sanitized).toEqual({
      type: 'object',
      properties: {
        dossier: { type: 'string' },
        useCases: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              titre: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['titre', 'description'],
          },
        },
      },
      required: ['dossier', 'useCases'],
    });
  });

  it('does not mutate the original schema object', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        additionalProperties: { type: 'string' },
      },
    } as Record<string, unknown>;

    const original = JSON.parse(JSON.stringify(schema));
    const sanitized = sanitizeGeminiResponseSchema(schema);

    expect(schema).toEqual(original);
    expect(sanitized).not.toBe(schema);
    expect(
      (sanitized.properties as Record<string, unknown>).additionalProperties
    ).toEqual({ type: 'string' });
    expect('additionalProperties' in sanitized).toBe(false);
  });

  it('drops non-string enum values for Gemini response schema compatibility', () => {
    const schema = {
      type: 'object',
      properties: {
        rating: {
          type: 'number',
          enum: [0, 1, 3, 5, 8],
        },
        status: {
          type: 'string',
          enum: ['draft', 'ready'],
        },
      },
      required: ['rating', 'status'],
    } as Record<string, unknown>;

    const sanitized = sanitizeGeminiResponseSchema(schema);
    const properties = sanitized.properties as Record<string, Record<string, unknown>>;

    expect(properties.rating.enum).toBeUndefined();
    expect(properties.status.enum).toEqual(['draft', 'ready']);
  });
});
