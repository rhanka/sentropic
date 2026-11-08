import { expect, vi } from 'vitest';
import type { Context } from 'hono';
import { fixture, key, memoryRows } from './fixture';
import { createLiveController } from '../../../src/services/artifacts/live/controller';
import { createHostLiveApi } from '../../../src/services/artifacts/live/host-live-api';
import { createRemoteLive } from '../../../src/services/artifacts/live/remote-live';
import { createRemoteDrafts } from '../../../src/services/artifacts/live/remote-drafts';

/** Host live API harness: the controller over the remote adapters and in-memory host KV rows, two bound hosts. */
export const HEAD = 'b'.repeat(40); export const TREE = 'c'.repeat(40);
const hosts: Record<string, { hostId: string; storageScopeId: string }> = {
  immo: { hostId: 'immo', storageScopeId: key.storageScopeId }, other: { hostId: 'other', storageScopeId: 'scope-b' } };
export const fences = { liveSessionId: 'package-session', leaseEpoch: 7, routeEpoch: 9 };
/** The session invitation state the host pushes: its epoch and the latest active expiry (ms) or null. */
export const session = (epoch: number, expiresAt: number | null = null) => ({ epoch, expiresAt });
export const reconcile = (over: Record<string, unknown> = {}) =>
  ({ artifactId: key.artifactId, bindingGeneration: 1, ownerId: 'owner', ...fences, invitation: session(1), ...over });
export const stop = (over: Record<string, unknown> = {}) =>
  ({ artifactId: key.artifactId, bindingGeneration: 1, liveSessionId: fences.liveSessionId, leaseEpoch: fences.leaseEpoch, ...over });
export const grant = (actor: Record<string, unknown>, invitation: unknown = session(1)) =>
  ({ artifactId: key.artifactId, access: 'read', actor, invitation });
export const invitee = (principalId: string, epoch: number, expiresAt: number) =>
  ({ principalId, invitation: { id: `inv-${principalId}`, epoch, expiresAt } });
export const file = (path: string, text: string) => ({ path, mode: 0o644, data: Buffer.from(text).toString('base64') });

export function setup(waitMs = 5_000) {
  const f = fixture(); f.binding.headSha = HEAD;
  const rows = memoryRows(); const remote = createRemoteLive(rows); const drafts = createRemoteDrafts(rows);
  const controller = createLiveController({ ...f.ports, drafts: drafts.drafts, invitations: remote.invitations });
  const authenticate = vi.fn((c: Context) => hosts[c.req.header('x-test-host') ?? ''] ?? null);
  const app = createHostLiveApi({ authenticate, controller, store: f.ports.store, remote, drafts, waitMs });
  const call = (path: string, body: unknown, host = 'immo') => app.request(`/v1/live/${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-host': host }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  async function stage(revision: string, host = 'immo') {
    expect((await call('draft/page', { artifactId: key.artifactId, bindingGeneration: 1, revision, page: 0,
      files: [file('src/App.svelte', revision)] }, host)).status).toBe(204);
    expect((await call('draft/seal', { artifactId: key.artifactId, bindingGeneration: 1, revision, pages: 1, baseHeadSha: HEAD,
      treeSha: TREE, deletes: [] }, host)).status).toBe(204);
  }
  const routeEpoch = async () => (await f.state())!.runtime.routeEpoch;
  return { f, drafts, controller, call, stage, routeEpoch };
}
