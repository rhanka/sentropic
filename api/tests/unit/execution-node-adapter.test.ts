import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExecutionNodeAdapter, nodeJson } from '../../src/services/artifacts/live/execution-node-adapter';
import { executionNodeTransport } from '../../src/services/artifacts/live/execution-node-transport';
import { exportRetainedBuild } from '../../src/services/artifacts/live/execution-node-lifecycle';
import { issueNodeCustody, revokeNodeCustody } from '../../src/services/artifacts/live/execution-node-custody';
import { fakeExecutionNode, sandboxSpec, session } from './execution-node-fake';

describe('ExecutionNodeV1 API control plane', () => {
  const servers: Awaited<ReturnType<typeof fakeExecutionNode>>[] = [];
  const setup = async () => { const fake = await fakeExecutionNode(); servers.push(fake); return fake; };
  afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });

  it('should refuse mutations without heartbeat and after five seconds without it', async () => {
    const fake = await setup(); const s = session();
    await expect(fake.adapter.create(s, sandboxSpec(s), 'create')).rejects.toMatchObject({ code: 'control_plane_unavailable' });
    await fake.adapter.inspect(); await fake.adapter.heartbeat();
    fake.advance(5001);
    await expect(fake.adapter.create(s, sandboxSpec(s), 'create')).rejects.toMatchObject({ code: 'control_plane_unavailable' });
    expect(fake.calls.filter(c => c.path.includes('heartbeat')).every(c => c.tenant === undefined)).toBe(true);
  });
  it('should preserve the full ownership envelope and replay identical signed creation only once', async () => {
    const fake = await setup(); await fake.adapter.heartbeat(); const s = session();
    const first = await fake.adapter.create(s, sandboxSpec(s), 'create');
    const replay = await fake.adapter.create(s, sandboxSpec(s), 'create');
    expect(first.id).toBe(replay.id);
    expect(first.ownership).toEqual(s.ownership);
    await expect(fake.adapter.create(s, { ...sandboxSpec(s), quotaMiB: 513 }, 'create'))
      .rejects.toMatchObject({ code: 'command_id_payload_mismatch', status: 409 });
  });
  it('should stop, verify export, upload by presigned URL and destroy in that order', async () => {
    const fake = await setup(); await fake.adapter.heartbeat(); let s = session();
    const created = await fake.adapter.create(s, sandboxSpec(s), 'create'); s = { ...s, physicalUid: String(created.id) };
    await fake.adapter.mutate(s, 'start', 'start', { uid: 1000, gid: 1000 });
    const upload = vi.fn(async () => new Response(null, { status: 200 }));
    const result = await exportRetainedBuild(fake.adapter, s, { buildId: 'build', stopCommandId: 'stop',
      exportCommandId: 'export', deleteCommandId: 'delete', presignedPutUrl: 'https://s3.test/object', maxBytes: 1024 * 1024 },
    { validateUrl: vi.fn(), upload });
    expect(result.provenance.tenantId).toBe('sentropic'); expect(upload).toHaveBeenCalledOnce();
    expect(fake.calls.slice(-3).map(c => c.path.split('/').pop())).toEqual(['stop', 'export', s.physicalUid]);
    expect(fake.node.daemon.getSandbox('sentropic', s.physicalUid)?.state).toBe('destroyed');
  });
  it('should retain exported output when upload fails', async () => {
    const fake = await setup(); await fake.adapter.heartbeat(); let s = session();
    const created = await fake.adapter.create(s, sandboxSpec(s), 'create'); s = { ...s, physicalUid: String(created.id) };
    await fake.adapter.mutate(s, 'start', 'start', { uid: 1000, gid: 1000 });
    await expect(exportRetainedBuild(fake.adapter, s, { buildId: 'build', stopCommandId: 'stop', exportCommandId: 'export',
      deleteCommandId: 'delete', presignedPutUrl: 'https://s3.test/object', maxBytes: 1024 * 1024 },
    { validateUrl() {}, upload: async () => new Response(null, { status: 503 }) })).rejects.toMatchObject({ code: 'artifact_upload_failed' });
    expect(fake.node.daemon.getSandbox('sentropic', s.physicalUid)?.state).toBe('exported');
  });
  it('should reject foreign tenants and changed devScope on session mutation', async () => {
    const fake = await setup(); await fake.adapter.heartbeat(); const s = session();
    const created = await fake.adapter.create(s, sandboxSpec(s), 'create'); const uid = String(created.id);
    await expect(fake.adapter.mutate({ ...session('immo'), physicalUid: uid }, 'start', 'foreign'))
      .rejects.toMatchObject({ code: 'unknown_node_instance', status: 409 });
    await expect(fake.adapter.mutate({ ...s, physicalUid: uid, devScope: { ...s.devScope, writable: ['**'] } }, 'start', 'changed'))
      .rejects.toMatchObject({ code: 'command_id_payload_mismatch' });
  });
  it('should surface 429 admission without retrying or losing the tenant', async () => {
    const fake = await setup(); await fake.adapter.heartbeat(); const s = session();
    await fake.adapter.create(s, { ...sandboxSpec(s), profile: 'node-22' }, 'create');
    const calls = fake.calls.length;
    await expect(fake.adapter.create(s, { ...sandboxSpec(s), profile: 'node-22' }, 'another')).rejects.toMatchObject({ status: 429, retryAfterMs: 1000 });
    expect(fake.calls).toHaveLength(calls + 1); expect(fake.calls.at(-1)?.tenant).toBe('sentropic');
  });
  it.each(['nodeEpoch', 'nodeInstanceId', 'provenanceKey'] as const)('should latch refusal on %s mismatch', async field => {
    const fake = await setup(); const alarm = vi.fn();
    const config = { ...fake.config, ...(field === 'nodeEpoch' ? { nodeEpoch: 1 }
      : field === 'nodeInstanceId' ? { nodeInstanceId: 'unexpected' } : { provenanceKey: fake.config.ticketKey }) };
    const adapter = new ExecutionNodeAdapter(config, fake.adapter.transport, Date.now, alarm);
    await expect(adapter.inspect()).rejects.toMatchObject({ code: 'execution_node_identity_mismatch' });
    await expect(adapter.heartbeat()).rejects.toMatchObject({ code: 'execution_node_identity_mismatch' });
    expect(alarm).toHaveBeenCalledOnce();
  });
  it('should reject invalid mTLS client credentials before dispatch', async () => {
    const fake = await setup(); const transport = executionNodeTransport({ ...fake.config, tls: { ...fake.config.tls, cert: Buffer.alloc(0), key: Buffer.alloc(0) } });
    try { await expect(transport('GET', '/v1/node')).rejects.toMatchObject({ code: 'node_transport_failure' }); }
    finally { transport.close(); }
    expect(fake.calls).toHaveLength(0);
  });
  it('should bound custody TTL and refuse revoked epochs at the real agent', async () => {
    const fake = await setup(); await fake.adapter.heartbeat(); let s = session();
    const created = await fake.adapter.create(s, sandboxSpec(s), 'create'); s = { ...s, physicalUid: String(created.id) };
    const token = issueNodeCustody(fake.adapter, s, 'principal', 1);
    expect(Date.parse(token.claims.deadlineAt) - Date.parse(token.claims.issuedAt)).toBe(60_000);
    expect(() => issueNodeCustody(fake.adapter, s, 'principal', 1, 60_001)).toThrow();
    const updated = await revokeNodeCustody(fake.adapter, s, 2, 'owner_changed', 'revoke');
    expect(updated.ownership.custodyEpoch).toBe(2);
    expect(() => fake.custody.authorize(token.claims, 'sentropic', s.physicalUid)).toThrow(/custody_revoked/);
    await expect(fake.adapter.mutate(s, 'renew', 'old')).rejects.toMatchObject({ status: 403 });
    const next = nodeJson(await fake.adapter.mutate(updated, 'renew', 'new')); expect(next).toBeDefined();
  });
});
