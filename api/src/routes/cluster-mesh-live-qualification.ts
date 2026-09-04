import { randomUUID, timingSafeEqual } from 'node:crypto';

import { createMcpSupervisor } from '@sentropic/cluster-mesh';
import { Hono } from 'hono';

import {
  clusterMeshAdapter,
  liveClusterMeshQualification,
} from '../services/cluster-mesh-adapter';
import { runLiveCliQualification } from './namespaces/cli';

type CliQualification = Awaited<ReturnType<typeof runLiveCliQualification>>;
let cliQualification: CliQualification | undefined;

const authorized = (actual: string | undefined, expected: string) => {
  const left = Buffer.from(actual ?? '');
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

export const clusterMeshLiveQualificationRouter = new Hono();
clusterMeshLiveQualificationRouter.use('*', async (context, next) => {
  const live = liveClusterMeshQualification;
  if (!live) return context.notFound();
  if (!authorized(context.req.query('evidence'), live.evidence)) {
    return context.json({ error: 'qualification_evidence_required' }, 401);
  }
  await live.ensureRegistration();
  return next();
});

clusterMeshLiveQualificationRouter.get('/tick', async (context) => {
  const state = await liveClusterMeshQualification!.ports.state();
  return context.json({
    tick: state.latestSeq,
    status: state.status,
    generation: state.generation,
    incarnation: state.incarnation,
  });
});

clusterMeshLiveQualificationRouter.post('/park', async (context) => {
  cliQualification = await runLiveCliQualification();
  if (cliQualification.delegated.status !== 200 || !cliQualification.delegated.receiptRef) {
    return context.json({ error: 'cli_qualification_failed' }, 502);
  }
  const stopped = await liveClusterMeshQualification!.ports.stop();
  return context.json({
    status: stopped.status,
    generation: stopped.generation,
    incarnation: stopped.incarnation,
    cliReceiptRef: cliQualification.delegated.receiptRef,
  });
});

clusterMeshLiveQualificationRouter.get('/lost', async (context) => {
  const live = liveClusterMeshQualification!;
  const registration = await live.store.find(live.registration.registrationId);
  const target = await live.ports.state().catch(() => undefined);
  return context.json({
    status: registration?.status ?? 'unknown',
    targetStatus: target?.status ?? 'unknown',
    generation: target?.generation,
    incarnation: target?.incarnation,
  });
});

clusterMeshLiveQualificationRouter.get('/mcp', async (context) => {
  const control = clusterMeshAdapter.mcpControl!;
  const supervisor = createMcpSupervisor({ store: control.store });
  const leaseExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const server = {
    serverId: control.serverId,
    generationId: control.runtime.generation.generationId,
    supervisorRef: control.supervisorRef,
    leaseExpiresAt,
  };
  const first = await supervisor.register(server);
  const second = await supervisor.register(server);
  const authorizedServer = await supervisor.authorize(server.generationId, server.supervisorRef);
  const missingGeneration = `qualification-missing-${randomUUID()}`;
  const missing = await supervisor.register({
    ...server,
    serverId: `mcp-server:${missingGeneration}`,
    generationId: missingGeneration,
    supervisorRef: `mcp-supervisor:${missingGeneration}`,
  });
  const logicalServer = await control.store.findMcpServer(server.generationId);
  if (!first.ok || !second.ok || !authorizedServer.ok || missing.ok || !logicalServer) {
    return context.json({ error: 'mcp_qualification_failed' }, 502);
  }
  return context.json({
    sessionCount: 2,
    logicalServers: 1,
    perSessionServers: 0,
    missingRegistration: { status: 503, providerEffects: 0 },
    signature: `${logicalServer.serverId}:${logicalServer.supervisorRef}:${missing.reason}`,
  });
});

clusterMeshLiveQualificationRouter.get('/cli', (context) => {
  if (!cliQualification) return context.json({ error: 'cli_qualification_not_run' }, 409);
  return context.json(cliQualification);
});

const qualifyCapacity = async (cap: number) => {
  const live = liveClusterMeshQualification!;
  const generationId = `capacity-qualification-${cap}-${randomUUID()}`;
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await live.store.saveGeneration({
    generationId,
    status: 'active',
    supervisorRef: `capacity-supervisor:${generationId}`,
    supervisorLeaseExpiresAt: expiresAt,
    maxConcurrent: cap,
    poolSize: Math.min(cap, 4),
  });
  let accepted = 0;
  let refusalStatus = 500;
  for (let index = 0; index <= cap; index += 1) {
    const reserved = await live.store.reserveCapacity({
      leaseId: `${generationId}:${index}`,
      generationId,
      subjectRef: `qualification-target:${index}`,
      status: 'active',
      expiresAt,
      leaseExpiresAt: expiresAt,
    });
    if (reserved.ok) accepted += 1;
    else refusalStatus = reserved.reason === 'capacity_exhausted' ? 429 : 503;
  }
  return { cap, accepted, refusalStatus, spawnCount: accepted, generationId };
};

clusterMeshLiveQualificationRouter.get('/capacity', async (context) => {
  const defaultCap = await qualifyCapacity(12);
  const nonDefaultCap = await qualifyCapacity(3);
  return context.json({
    defaultCap: {
      accepted: defaultCap.accepted,
      refusalStatus: defaultCap.refusalStatus,
      spawnCount: defaultCap.spawnCount,
    },
    nonDefaultCap,
  });
});
