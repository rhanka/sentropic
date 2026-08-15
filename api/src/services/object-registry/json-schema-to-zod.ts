/**
 * Generates a zod schema from a `control.object_type_definitions` JSON Schema
 * (DD2a=B: registry JSON Schema is the single source of truth; the route zod is
 * GENERATED from it, one direction — SPEC_EVOL_DATA_ARCHITECTURE.md:488).
 *
 * Supports ONLY the JSON Schema subset actually used by registered object types
 * in this repo — NOT a general JSON Schema → zod converter:
 *   - type: 'object' (properties + required)
 *   - type: 'string' (minLength)
 *   - type: 'number' (minimum, maximum)
 *   - type: 'array' (items, recursive)
 * An unsupported shape throws at generation time (boot), so schema drift is
 * caught immediately rather than silently accepted.
 */
import { z } from 'zod';

export type JsonSchema = Record<string, unknown>;

type Prop<S> = S extends { readonly type: 'string' }
  ? z.ZodString
  : S extends { readonly type: 'number' }
    ? z.ZodNumber
    : S extends { readonly type: 'array'; readonly items: infer I }
      ? z.ZodArray<Prop<I>>
      : S extends {
            readonly type: 'object';
            readonly properties: infer P;
            readonly required?: infer R;
          }
        ? z.ZodObject<{
            [K in keyof P]: K extends (R extends ReadonlyArray<string> ? R[number] : never)
              ? Prop<P[K]>
              : z.ZodOptional<Prop<P[K]>>;
          }>
        : z.ZodTypeAny;

function buildZod(schema: JsonSchema): z.ZodTypeAny {
  switch (schema.type) {
    case 'string': {
      let s = z.string();
      if (typeof schema.minLength === 'number') s = s.min(schema.minLength);
      return s;
    }
    case 'number': {
      let n = z.number();
      if (typeof schema.minimum === 'number') n = n.min(schema.minimum);
      if (typeof schema.maximum === 'number') n = n.max(schema.maximum);
      return n;
    }
    case 'array': {
      const items = schema.items;
      if (!items || typeof items !== 'object') {
        throw new Error('json-schema-to-zod: array schema requires "items"');
      }
      return z.array(buildZod(items as JsonSchema));
    }
    case 'object': {
      const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
      const required = new Set((schema.required as string[] | undefined) ?? []);
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, propSchema] of Object.entries(props)) {
        const propZod = buildZod(propSchema);
        shape[key] = required.has(key) ? propZod : propZod.optional();
      }
      return z.object(shape);
    }
    default:
      throw new Error(`json-schema-to-zod: unsupported schema type "${String(schema.type)}"`);
  }
}

/** Generate a fully-typed zod object schema from a registered object type's JSON Schema. */
export function generateZodFromJsonSchema<const S extends JsonSchema>(jsonSchema: S): Prop<S> {
  return buildZod(jsonSchema) as Prop<S>;
}
