// The host module supplies verified identity, policies, custody and PostgreSQL.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createClusterMeshModules } from '@sentropic/cluster-mesh';
import { createMcpRegistry } from '@sentropic/cluster-mesh/mcp/registry';
import { createEngramMemoryBuiltin, registerEngramMemoryTools } from '@sentropic/cluster-mesh/mcp/memory';
import { loadMcpPlatformStdio } from '@sentropic/cluster-mesh/loaders/mcp';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--definition') {
  throw new Error('Usage: node memory-mcp-stdio.mjs --definition /absolute/host-definition.mjs');
}
let host, builtin, server;
let closing;
const close = () => closing ??= (async () => {
  try { await server?.close(); }
  finally { try { await builtin?.runtime()?.close(); } finally { await host?.close(); } }
})();
try {
  const modules = createClusterMeshModules();
  host = await (await import(pathToFileURL(resolve(args[1])).href)).createHost({ modules });
  builtin = createEngramMemoryBuiltin({ modules, definition: host.definition });
  const registry = createMcpRegistry({ modules, builtins: [builtin] });
  registry.select(['sentropic.engram.memory']);
  registry.configure('sentropic.engram.memory', {
    mode: 'embedded-local', hostBindingRef: host.definition.hostBindings.hostBindingRef,
  });
  const compiled = await registry.compile({ bindings: {}, compatibility: host.compatibility });
  if (!compiled.ok) throw new Error('Memory MCP compilation refused');
  server = new Server({ name: 'sentropic-memory-host', version: '1.0.0' }, { capabilities: { tools: {} } });
  await registerEngramMemoryTools(server, { modules, registry: compiled.registry, builtin, definition: host.transport });
  const stdio = await loadMcpPlatformStdio(modules);
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
  await server.connect(stdio.createStdioTransport());
  process.stdin.once('end', () => { void close(); });
} catch {
  await close();
  process.stderr.write('Memory MCP host startup failed\n');
  process.exitCode = 1;
}
