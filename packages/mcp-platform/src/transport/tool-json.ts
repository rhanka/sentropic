/** Resource budgets are independent of a provider schema's semantic bounds. */
export interface McpToolValidationLimits {
  readonly maxSchemaBytes: number;
  readonly maxSchemaDepth: number;
  readonly maxRequestBytes: number;
  readonly maxArgumentBytes: number;
  readonly maxArgumentDepth: number;
  readonly maxResultBytes: number;
  readonly maxResultDepth: number;
}

export function validateMcpLimits(limits: McpToolValidationLimits): void {
  for (const key of ['maxSchemaBytes', 'maxSchemaDepth', 'maxRequestBytes',
    'maxArgumentBytes', 'maxArgumentDepth', 'maxResultBytes', 'maxResultDepth'] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0) {
      throw new TypeError(`MCP limit ${key} must be a positive safe integer`);
    }
  }
}

/** Reject non-JSON values before SDK validation, cloning or invocation. */
export function assertMcpJson(value: unknown, maxBytes: number, maxDepth: number): void {
  let bytes = 0;
  const active = new Set<object>();
  const add = (text: string) => {
    bytes += Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) throw new TypeError('MCP JSON byte budget exceeded');
  };
  const visit = (item: unknown, depth: number): void => {
    if (depth > maxDepth) throw new TypeError('MCP JSON depth budget exceeded');
    if (item === null || typeof item === 'string' || typeof item === 'boolean'
      || (typeof item === 'number' && Number.isFinite(item))) {
      add(JSON.stringify(item));
      return;
    }
    if (typeof item !== 'object' || item === null || active.has(item)) {
      throw new TypeError('MCP requires finite acyclic JSON');
    }
    const array = Array.isArray(item);
    if (array && item.length > maxBytes) throw new TypeError('MCP JSON byte budget exceeded');
    if (!array && Object.getPrototypeOf(item) !== Object.prototype
      && Object.getPrototypeOf(item) !== null) throw new TypeError('MCP requires plain JSON objects');
    if (Object.getOwnPropertySymbols(item).length) throw new TypeError('MCP requires JSON keys');
    active.add(item);
    add(array ? '[]' : '{}');
    const keys = array ? (function* () {
      for (let i = 0; i < item.length; i++) yield String(i);
    })() : Object.keys(item);
    let index = 0;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !('value' in descriptor)) throw new TypeError('MCP requires JSON data properties');
      if (index++) add(',');
      if (!array) add(JSON.stringify(key) + ':');
      visit(descriptor.value, depth + 1);
    }
    active.delete(item);
  };
  visit(value, 0);
}

export function freezeMcpJson<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) freezeMcpJson(child);
    Object.freeze(value);
  }
  return value;
}

/** Same advertised-default traversal as #689, shared here by native wire tools. */
export function applyMcpDefaults(schema: unknown, value: unknown): unknown {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return value;
  const definition = schema as Record<string, unknown>;
  if (value === undefined && Object.hasOwn(definition, 'default')) return structuredClone(definition.default);
  if (typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof definition.properties === 'object' && definition.properties !== null) {
    const result = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(definition.properties)) {
      const filled = applyMcpDefaults(child, Object.hasOwn(result, key) ? result[key] : undefined);
      if (filled !== undefined) Object.defineProperty(result, key, {
        value: filled, writable: true, configurable: true, enumerable: true,
      });
    }
  }
  if (Array.isArray(value)) return value.map((item, i) => applyMcpDefaults(
    Array.isArray(definition.items) ? definition.items[i] : definition.items, item,
  ));
  return value;
}
