import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import type { JsonSchemaType, JsonSchemaValidatorResult } from '@modelcontextprotocol/sdk/validation/types.js';
import type { BridgeRunner, BridgeTool } from '@sentropic/mcp-platform/transport/bridge';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Apply the advertised defaults without modifying the caller's arguments. */
function defaults(schema: unknown, value: unknown): unknown {
  if (!record(schema)) return value;
  if (value === undefined && Object.hasOwn(schema, 'default')) return structuredClone(schema.default);
  if (record(value) && record(schema.properties)) {
    const result = { ...value };
    for (const [name, child] of Object.entries(schema.properties)) {
      const filled = defaults(child, value[name]);
      if (filled !== undefined) result[name] = filled;
    }
    return result;
  }
  if (Array.isArray(value)) return value.map((item, index) => defaults(
    Array.isArray(schema.items) ? schema.items[index] : schema.items, item,
  ));
  return value;
}

/**
 * The platform bridge's configuration profile is narrower than host tool JSON Schema
 * (Radar uses draft-07 tuples and unbounded strings). Validate original schemas with
 * the SDK, preserving wire schemas/defaults; the bridge retains its JSON byte budget,
 * request dispatch and result codec. No platform API or provider schema is changed.
 */
export function compileOAuthToolSchemas(tools: readonly BridgeTool[]) {
  const sdk = new AjvJsonSchemaValidator();
  const validators = new Map(tools.map((tool) => {
    if (!record(tool.schema)) throw new TypeError('MCP tool schema must be an object');
    const schema: Record<string, unknown> = { type: 'object', ...tool.schema };
    if (schema.$async !== undefined) throw new TypeError('Async tool schemas are unsupported');
    return [tool.name, sdk.getValidator<Parameters<BridgeRunner['run']>[1]>(schema as JsonSchemaType)] as const;
  }));
  return {
    bridgeTools: tools.map((tool) => ({ ...tool, schema: {} })),
    list: () => tools.map((tool) => ({ name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      inputSchema: { type: 'object' as const, ...(tool.schema as Record<string, unknown>) },
    })),
    validate(tool: string, args: Parameters<BridgeRunner['run']>[1]): JsonSchemaValidatorResult<Parameters<BridgeRunner['run']>[1]> {
      const source = tools.find((entry) => entry.name === tool)!;
      return validators.get(tool)!(defaults(source.schema, args));
    },
  };
}
