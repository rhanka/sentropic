import { Hono, type Context } from 'hono';
import { hostGate, type HostBuildEnv, type HostIdentity } from './host-build-api';
import type { LiveKey } from './records';
import type { createLiveController } from './controller';
import { createLiveWorkerBridge, type BridgeAck, type BridgeIdentity } from './bridge';
import type { LiveStore } from './ports';
import type { RemoteLive } from './remote-live';
import type { RemoteDrafts } from './remote-drafts';
import { actorOf, closed, CONTROL_BYTES, filesOf, id, int, invalid, json, limited, objectId, PAGE_BYTES, paths, refusal,
  SEAL_BYTES, sessionInvitationOf, token } from './host-live-body';

const RECONCILE = ['artifactId', 'bindingGeneration', 'ownerId', 'liveSessionId', 'leaseEpoch', 'routeEpoch', 'invitation'];
const STOP = ['artifactId', 'bindingGeneration', 'liveSessionId', 'leaseEpoch'];
const GRANT = ['artifactId', 'access', 'actor', 'invitation'];
const PAGE = ['artifactId', 'bindingGeneration', 'revision', 'page', 'files'];
const SEAL = ['artifactId', 'bindingGeneration', 'revision', 'pages', 'baseHeadSha', 'treeSha', 'deletes'];

/**
 * A-LIVE remote host API (s-archi contract 07/11), behind the same S2S gate as the builds: the host runs the package
 * LiveService and drives the controller through the bridge; the scope always comes from the bound host identity.
 * A reconcile answers within `waitMs`; a longer revive keeps running and answers `ready: false` with the current fences.
 */
export function createHostLiveApi(options: {
  authenticate(c: Context): HostIdentity | null; controller: ReturnType<typeof createLiveController>; store: LiveStore;
  remote: RemoteLive; drafts: RemoteDrafts; waitMs: number;
}) {
  const { remote, drafts } = options;
  const bridge = createLiveWorkerBridge({ controller: options.controller, ports: { store: options.store, drafts: drafts.drafts },
    packageRuntime: identity => remote.fences(identity, identity.bindingGeneration) });
  const lanes = new Map<string, { identity: BridgeIdentity; next: Promise<BridgeAck> | null; tail: Promise<void> }>();
  /** One reconcile per binding in this replica; callers that arrive before the queued run starts join it. */
  function serial(identity: BridgeIdentity): Promise<BridgeAck> {
    const lid = JSON.stringify([identity.storageScopeId, identity.artifactId]);
    const lane = lanes.get(lid) ?? { identity, next: null, tail: Promise.resolve() };
    lane.identity = identity;
    if (lane.next) return lane.next;
    const run = lane.tail.then(() => { lane.next = null; return bridge.reconcile(lane.identity); });
    const tail = run.then(() => undefined, () => undefined);
    Object.assign(lane, { next: run, tail }); lanes.set(lid, lane);
    void tail.then(() => { if (lane.tail === tail) lanes.delete(lid); });
    return run;
  }
  async function within(identity: BridgeIdentity): Promise<BridgeAck> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), options.waitMs); });
    try {
      const ack = await Promise.race([serial(identity), late]);
      if (ack) return ack;
      const { revision } = await drafts.drafts.current(identity, identity.bindingGeneration);
      return { ...await remote.fences(identity, identity.bindingGeneration), revision, ready: false };
    } finally { clearTimeout(timer); }
  }
  const app = new Hono<HostBuildEnv>();
  app.use('*', hostGate(options.authenticate));
  const keyOf = (c: Context<HostBuildEnv>, artifactId: string): LiveKey => ({ storageScopeId: c.get('identity').storageScopeId, artifactId });
  app.post('/v1/live/reconcile', limited(CONTROL_BYTES), async c => {
    const b = await json(c); const invitation = closed(b, RECONCILE) ? sessionInvitationOf(b.invitation) : null;
    if (!invitation || !closed(b, RECONCILE) || !id(b.artifactId) || !int(b.bindingGeneration, 1) || !token(b.ownerId)
      || !id(b.liveSessionId) || !int(b.leaseEpoch) || !int(b.routeEpoch)) return invalid(c);
    const identity = { ...keyOf(c, b.artifactId), bindingGeneration: b.bindingGeneration };
    try {
      await remote.reconciled(identity, { generation: b.bindingGeneration, ownerId: b.ownerId, liveSessionId: b.liveSessionId,
        leaseEpoch: b.leaseEpoch, routeEpoch: b.routeEpoch });
      await remote.invitation(identity, b.bindingGeneration, invitation);
      // A revocation pushed with the reconcile fences the route at once (a no-op unless LIVE and the epoch moved).
      await options.controller.fenceInvitations(identity);
      return c.json(await within(identity));
    } catch (error) { return refusal(c, error); }
  });
  app.post('/v1/live/stop', limited(CONTROL_BYTES), async c => {
    const b = await json(c);
    if (!closed(b, STOP) || !id(b.artifactId) || !int(b.bindingGeneration, 1) || !id(b.liveSessionId) || !int(b.leaseEpoch)) return invalid(c);
    try {
      await bridge.stop({ ...keyOf(c, b.artifactId), bindingGeneration: b.bindingGeneration, liveSessionId: b.liveSessionId,
        leaseEpoch: b.leaseEpoch });
      return c.body(null, 204);
    } catch (error) { return refusal(c, error); }
  });
  app.post('/v1/live/grant', limited(CONTROL_BYTES), async c => {
    const b = await json(c);
    const actor = closed(b, GRANT) ? actorOf(b.actor) : null; const invitation = closed(b, GRANT) ? sessionInvitationOf(b.invitation) : null;
    if (!actor || !invitation || !closed(b, GRANT) || !id(b.artifactId) || b.access !== 'read') return invalid(c);
    const key = keyOf(c, b.artifactId);
    try {
      // The host invitation state is authoritative (§9): it is recorded for the reconciled generation, then a higher
      // epoch (a revocation) fences the route before any new grant, and a later expiry is adopted without fencing.
      await remote.invitation(key, (await remote.session(key)).generation, invitation);
      await options.controller.fenceInvitations(key);
      return c.json({ grant: await options.controller.authorize(key, actor, 'read') });
    } catch (error) { return refusal(c, error); }
  });
  app.post('/v1/live/draft/page', limited(PAGE_BYTES), async c => {
    const b = await json(c); const files = closed(b, PAGE) ? filesOf(b.files) : null;
    if (!files || !closed(b, PAGE) || !id(b.artifactId) || !int(b.bindingGeneration, 1) || !token(b.revision) || !int(b.page)) return invalid(c);
    try {
      await drafts.page(keyOf(c, b.artifactId), { generation: b.bindingGeneration, revision: b.revision, page: b.page, files });
      return c.body(null, 204);
    } catch (error) { return refusal(c, error); }
  });
  app.post('/v1/live/draft/seal', limited(SEAL_BYTES), async c => {
    const b = await json(c);
    if (!closed(b, SEAL) || !id(b.artifactId) || !int(b.bindingGeneration, 1) || !token(b.revision) || !int(b.pages)
      || !objectId(b.baseHeadSha) || !objectId(b.treeSha) || !paths(b.deletes)) return invalid(c);
    try {
      await drafts.seal(keyOf(c, b.artifactId), { generation: b.bindingGeneration, revision: b.revision, pages: b.pages,
        baseHeadSha: b.baseHeadSha, treeSha: b.treeSha, deletes: b.deletes });
      return c.body(null, 204);
    } catch (error) { return refusal(c, error); }
  });
  return app;
}
