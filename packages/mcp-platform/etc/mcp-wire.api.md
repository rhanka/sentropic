# MCP native wire API additions (0.4.0)

The frozen root API report remains unchanged. These optional transport leaves
are qualified through installed public-subpath imports and SDK transport tests.

| Public subpath | Public symbols |
| --- | --- |
| transport/tool-schemas | compileMcpToolSchemas, CompiledMcpToolSchemas, McpToolValidationLimits, McpToolDiagnostic, McpToolValidation |
| transport/bridge | registerMcpWireTools, McpWireRunner, McpWireBridgeOptions, McpWireFailure; existing BridgeTool/BridgeRunner remain explicit application mode |
| transport/result-codec | validateMcpWireResult; existing encodeToolResult and decodeToolResult |
| registry | CompiledToolResolution now includes readonly inputSchema: unknown from the frozen digest-bound manifest |

```ts
compileMcpToolSchemas(tools: readonly Tool[], limits: McpToolValidationLimits): CompiledMcpToolSchemas;
interface CompiledMcpToolSchemas {
  validate(name: string, args: unknown): McpToolValidation;
}
type McpToolValidation =
  | { readonly valid: true; readonly data: Record<string, unknown> }
  | { readonly valid: false; readonly diagnostics: readonly McpToolDiagnostic[] };
interface McpToolDiagnostic { readonly path: string; readonly message: string }
interface McpToolValidationLimits {
  readonly maxSchemaBytes: number;
  readonly maxSchemaDepth: number;
  readonly maxRequestBytes: number;
  readonly maxArgumentBytes: number;
  readonly maxArgumentDepth: number;
  readonly maxResultBytes: number;
  readonly maxResultDepth: number;
}
interface McpWireRunner {
  run(name: string, args: Record<string, unknown>,
    extra: Readonly<{ signal: AbortSignal }>): Promise<CallToolResult>;
}
type McpWireFailure =
  | { readonly kind: 'invalid-arguments'; readonly diagnostics: readonly McpToolDiagnostic[] }
  | { readonly kind: 'internal' };
interface McpWireBridgeOptions {
  readonly schemas: CompiledMcpToolSchemas;
  readonly limits: McpToolValidationLimits;
  formatFailure(name: string, failure: McpWireFailure): CallToolResult;
}
registerMcpWireTools(server: Server, tools: readonly Tool[], runner: McpWireRunner,
  options: McpWireBridgeOptions): void;
validateMcpWireResult(result: unknown, limits: McpToolValidationLimits): CallToolResult;
```
