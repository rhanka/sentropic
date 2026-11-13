import assert from 'node:assert/strict';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { createExecutionNode } from './index.js';
import { generateTicketKeyPair, issueTicket, sha256Hex } from './tickets.js';
import { AgentApi } from './api.js';
import { CustodyGuard } from './custody.js';
import { basePath } from './mounts.js';
import type { ExecutionNodeOwnership } from './contract.js';
import type { SandboxRecord } from './daemon.js';

function fileHash(path: string) {
  const fd = openSync(path, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  try {
    for (;;) {
      const length = readSync(fd, buffer, 0, buffer.length, null);
      if (!length) return hash.digest('hex');
      hash.update(buffer.subarray(0, length));
    }
  } finally { closeSync(fd); }
}

// A real daemon and adapter, with keys and state belonging only to this qualification.
export function qualificationNode(directory: string, release: string) {
  const keys = generateTicketKeyPair();
  const rootfs = join(release, 'rootfs.erofs');
  const rootDigest = fileHash(rootfs);
  const node = createExecutionNode({ useRunsc: true, ticketPublicKeyPem: keys.publicKeyPem,
    sharedRootfs: { path: rootfs, digest: rootDigest } });
  const custody = new CustodyGuard(join(directory, 'custody.wal'));
  const api = new AgentApi(node, custody);
  let ownership: ExecutionNodeOwnership = { tenantId: 'sentropic', poolOwned: false,
    workspaceId: 'qualification', principalId: 'qualification', sessionId: 'qualification',
    buildId: 'qualification', jobId: 'qualification', attemptId: 'qualification',
    purpose: 'qualification', generation: 1, custodyEpoch: 1 };
  const devScope = { kind: 'ui' as const, writable: ['ui/**'], refused: ['ui/dist/**'],
    source: { repo: 'qualification', path: 'qualification', commit: 'qualification' } };
  const createdBases: string[] = [];
  let sandbox: SandboxRecord | undefined;
  const call = (path: string, body: Record<string, unknown>, method = 'POST') => {
    custody.heartbeat(); const now = Date.now();
    const ticket = issueTicket({ v: 1, tenantId: 'sentropic', commandId: String(body.commandId), method, path,
      bodySha256: sha256Hex(JSON.stringify(body)), targetNodeId: node.daemon.nodeId,
      expectedNodeInstanceId: node.daemon.nodeInstanceId, expectedNodeEpoch: node.daemon.nodeEpoch,
      ownership: { ...ownership }, issuedAt: new Date(now).toISOString(), deadlineAt: new Date(now + 30000).toISOString(),
    }, keys.privateKeyPem);
    return api.dispatch({ path, body, method, tenantId: 'sentropic', role: 'control-plane', ticket });
  };
  return { node, custody, keys, get ownership() { return ownership; },
    async start() {
      const identityDigest = fileHash(join(release, 'qualification.erofs'));
      const base = { tenantId: 'sentropic' as const, kind: 'source' as const, baseId: 'qualification', identityDigest };
      const path = basePath(base); mkdirSync(dirname(path), { recursive: true });
      if (!existsSync(path)) { copyFileSync(join(release, 'qualification.erofs'), path); createdBases.push(path); }
      assert.equal(fileHash(path), identityDigest);
      node.bases.register(base);
      // HTTP streaming and HMR run inside gVisor's network namespace, on the production service port.
      const script = `const h=require('http'),c=require('crypto'),f=require('fs');
        f.writeFileSync('/workspace/ui/dist/index.html','qualification');
        const s=h.createServer((q,r)=>{r.writeHead(200);r.write('qualification-stream')});
        s.on('upgrade',(q,x)=>{const a=c.createHash('sha1').update(q.headers['sec-websocket-key']+
        '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        x.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: '+a+'\\r\\n\\r\\n')});
        s.listen(5173,'0.0.0.0');`;
      const created = await call('/v1/sandboxes', { commandId: 'qualification-create', ownership,
        spec: { tenantId: 'sentropic', devScope, profile: 'artifact-build', network: 'ports',
          command: ['/usr/local/bin/node', '-e', script], uid: 1000, gid: 1000, quotaMiB: 1408, quotaInodes: 4096,
          baseMounts: [{ baseId: 'shared-rootfs', kind: 'rootfs', identityDigest: rootDigest }, base] } });
      sandbox = created.body as SandboxRecord;
      await call(`/v1/sandboxes/${sandbox.id}/start`, { commandId: 'qualification-start', devScope, quotaMiB: 1408, uid: 1000, gid: 1000 });
      return sandbox;
    },
    async revoke() {
      assert.ok(sandbox);
      const result = await call(`/v1/sandboxes/${sandbox.id}/revoke-custody`, {
        commandId: 'qualification-revoke', devScope, minCustodyEpoch: 2, reason: 'qualification' });
      assert.equal((result.body as { activeCustodyEpoch: number }).activeCustodyEpoch, 2);
      ownership = { ...ownership, custodyEpoch: 2 };
    },
    async lifecycle() {
      assert.ok(sandbox); const path = `/v1/sandboxes/${sandbox.id}`;
      assert.equal((await call(path, {}, 'GET')).status, 200);
      const stop = () => call(`${path}/stop`, { commandId: 'qualification-stop', devScope, stop: { retainOutput: true } });
      let result = await stop(); const deadline = Date.now() + 5000;
      while (result.status === 202 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25)); result = await stop();
      }
      assert.equal(result.status, 200);
      const output = await call(`${path}/export`, { commandId: 'qualification-export', devScope,
        spec: { buildId: 'qualification', subPath: 'ui/dist', maxBytes: 1024 * 1024 } });
      assert.equal(output.status, 200); assert.ok(Buffer.isBuffer(output.body) && output.body.length > 0);
      assert.equal((await call(path, { commandId: 'qualification-delete', devScope }, 'DELETE')).status, 200);
    },
    async close() {
      // Also recover bundles registered by a partially failed launcher, without touching foreign resources.
      if (sandbox && sandbox.state !== 'destroyed') {
        const runtimeId = sandbox.runtimeId ?? `runsc-sentropic-${sandbox.id}`;
        if (existsSync(`/var/lib/builder/tenants/sentropic/sandboxes/${sandbox.id}`)) await node.adapter.destroySandbox(runtimeId);
      }
      for (const path of createdBases) rmSync(path);
    },
  };
}
