import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { SkillTool } from '../../../../../packages/skills/src/index.js';
import type { StandaloneToolHandler } from './standalone-tool-source.js';
import type { CatalogSource } from '../source.js';
import type { CatalogEntry, ToolEntry } from '../types.js';
export function sanitizeMcpToolName(rawName: string): string {
  return rawName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_') // replace invalid chars with _
    .replace(/[-]{2,}/g, '_')       // collapse consecutive dashes
    .replace(/[_]{2,}/g, '_')       // collapse consecutive underscores
    .replace(/^[_-]+|[_-]+$/g, ''); // strip leading/trailing separators
}
export interface McpSourceConfig {
  readonly serverName: string;
  readonly allowedTools?: ReadonlyArray<string>;
  readonly deniedTools?: ReadonlyArray<string>;
}
export class McpCatalogSource implements CatalogSource {
  readonly id: string;
  readonly kind = 'mcp' as const;
  private readonly config: McpSourceConfig;
  private readonly transportFactory: () => Transport;
  private _entries: ToolEntry[] = [];
  private readonly _handlers = new Map<string, StandaloneToolHandler>();
  constructor(config: McpSourceConfig, transportFactory: () => Transport) {
    this.config = config;
    this.transportFactory = transportFactory;
    this.id = `mcp:${config.serverName}`;
  }
  snapshot(): ReadonlyArray<CatalogEntry> {
    return this._entries;
  }
  getHandler(name: string): StandaloneToolHandler | undefined {
    return this._handlers.get(name);
  }
  private _applyToolList(
    rawTools: Array<{
      name: string;
      description?: string;
      inputSchema?: {
        type?: string;
        properties?: Record<string, unknown>;
        required?: string[];
        [key: string]: unknown;
      };
    }>,
  ): void {
    const allowedSet =
      this.config.allowedTools !== undefined
        ? new Set(this.config.allowedTools)
        : null;
    const deniedSet =
      this.config.deniedTools !== undefined
        ? new Set(this.config.deniedTools)
        : null;
    const newEntries: ToolEntry[] = [];
    const newHandlers = new Map<string, StandaloneToolHandler>();
    const sanitizedNameCounts = new Map<string, number>();
    for (const rawTool of rawTools) {
      if (allowedSet !== null && !allowedSet.has(rawTool.name)) continue;
      if (deniedSet !== null && deniedSet.has(rawTool.name)) continue;
      let publicName = sanitizeMcpToolName(rawTool.name);
      if (publicName.length === 0) {
        publicName = 'tool';
      }
      const baseName = publicName;
      const count = sanitizedNameCounts.get(baseName) ?? 0;
      sanitizedNameCounts.set(baseName, count + 1);
      if (count > 0) {
        publicName = `${baseName}_${count + 1}`;
      }
      const tool: SkillTool = {
        name: publicName,
        description: rawTool.description ?? `MCP tool: ${rawTool.name}`,
        inputSchema: this._buildInputSchema(rawTool.inputSchema),
      };
      const rawName = rawTool.name;
      const entry: ToolEntry = {
        kind: 'tool',
        sourceId: this.id,
        metadata: {
          name: publicName,
          description: tool.description,
          category: 'mcp',
        },
        tool,
        rawName,
      };
      const rawNameForHandler = rawName;
      const sourceId = this.id;
      const handler: StandaloneToolHandler = async (
        args: Record<string, unknown>,
      ) => {
        const { Client } = await import(
          '@modelcontextprotocol/sdk/client/index.js'
        );
        const callTransport = this.transportFactory();
        const callClient = new Client(
          { name: sourceId, version: '1.0.0' },
          { capabilities: {} },
        );
        await callClient.connect(callTransport);
        try {
          const result = await callClient.callTool({
            name: rawNameForHandler,
            arguments: args,
          });
          return result;
        } finally {
          await callClient.close();
        }
      };
      newEntries.push(entry);
      newHandlers.set(publicName, handler);
    }
    this._entries = newEntries;
    this._handlers.clear();
    for (const [k, v] of newHandlers) {
      this._handlers.set(k, v);
    }
  }
  private _buildInputSchema(
    inputSchema:
      | {
          type?: string;
          properties?: Record<string, unknown>;
          required?: string[];
          [key: string]: unknown;
        }
      | undefined,
  ): Record<string, unknown> {
    if (
      inputSchema === undefined ||
      inputSchema === null ||
      typeof inputSchema !== 'object'
    ) {
      return { type: 'object', properties: {} };
    }
    return inputSchema as Record<string, unknown>;
  }
}
