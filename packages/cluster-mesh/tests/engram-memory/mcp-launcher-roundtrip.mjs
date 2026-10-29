import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { captureInput } from '../../.memory-launcher/tests/engram-memory/mcp-dependencies.js';

const args = [resolve('examples/memory-mcp-stdio.mjs'), '--definition',
  resolve('.memory-launcher/tests/engram-memory/mcp-launcher-host.js')];
console.log(`launch: node ${args.join(' ')}`);
const transport = new StdioClientTransport({ command: process.execPath, args,
  env: { ...process.env }, stderr: 'inherit' });
const client = new Client({ name: 'memory-launcher-qualification', version: '1.0.0' });
const call = async (name, arguments_) => {
  const result = await client.callTool({ name, arguments: arguments_ });
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(result.structuredContent.ok, true);
  const value = result.structuredContent.output.value;
  console.log(JSON.stringify({ tool: name, arguments: arguments_, value }));
  return value;
};
try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 6);
  console.log(JSON.stringify({ tools: tools.tools.map(tool => tool.name) }));
  const captured = await call('engram_memory_capture', captureInput('launcher-capture-0001'));
  assert.equal(captured.status, 'committed_pending');
  assert.deepEqual((await call('engram_memory_search', { query: 'memory', purpose_ref: 'purpose-memory' })).records, []);
  const admitted = await call('engram_memory_request_admission', {
    candidate_id: captured.candidate_id, idempotency_key: 'launcher-admit-0001' });
  assert.equal(admitted.outcome.status, 'accepted');
  const record_id = admitted.outcome.record_id;
  assert.equal((await call('engram_memory_get', { record_id, purpose_ref: 'purpose-memory' })).record.record_id, record_id);
  assert.equal((await call('engram_memory_search', { query: 'memory', purpose_ref: 'purpose-memory' })).records.length, 1);
  const forgotten = await call('engram_memory_forget', { record_id,
    idempotency_key: 'launcher-forget-0001', reason_ref: 'reason-memory' });
  assert.equal(forgotten.receipt.to_state, 'tombstoned');
  assert.deepEqual((await call('engram_memory_search', { query: 'memory', purpose_ref: 'purpose-memory' })).records, []);
  const pending = await call('engram_memory_capture', captureInput('launcher-capture-0002'));
  const withdrawn = await call('engram_memory_withdraw', { candidate_id: pending.candidate_id,
    idempotency_key: 'launcher-withdraw-0001', reason_ref: 'reason-memory' });
  assert.equal(withdrawn.receipt.to_state, 'withdrawn');
} finally { await client.close(); await transport.close(); }
