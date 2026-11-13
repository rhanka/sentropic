import { ExecutionNodeAdapter, nodeJson, type NodeSession } from './execution-node-adapter';
import { ExecutionNodeRefusal } from './execution-node-transport';

export interface ExportProgress {
  uploaded?: { provenance: Record<string, unknown>; bytes: number };
  destroyed?: true;
}

/** D5-M1. Persist these command ids and upload destination with the build intent before calling.
 * The shipped agent returns gzip bytes + JWS; API verifies before using its presigned PUT URL.
 * Delete occurs only after confirmed upload. A failed export/upload retains output for retry.
 */
export async function exportRetainedBuild(node: ExecutionNodeAdapter, session: NodeSession, intent: {
  buildId: string; stopCommandId: string; exportCommandId: string; deleteCommandId: string;
  destination: string; command: readonly string[]; maxBytes: number;
}, options: { validateUrl(url: string, tenantId: string): void; upload?: typeof fetch;
  authorizeUpload(destination: string, tenantId: string): Promise<string>;
}, progress: ExportProgress = {}, persist: (progress: ExportProgress) => Promise<void> = async () => {}) {
  if (!intent.buildId || !Number.isSafeInteger(intent.maxBytes) || intent.maxBytes < 1 || intent.maxBytes > 64 * 1024 * 1024) {
    throw new ExecutionNodeRefusal('invalid_export_intent');
  }
  if (progress.destroyed && progress.uploaded) return progress.uploaded;
  let stop = await node.status(session);
  if (!stop) throw new ExecutionNodeRefusal('sandbox_not_found', 404);
  if (!progress.uploaded && (stop.state === 'running' || stop.state === 'stopping')) {
    stop = nodeJson<Record<string, unknown>>(await node.mutate(session, 'stop', intent.stopCommandId,
      { stop: { retainOutput: true, outputSubPath: 'ui/dist', retentionTtlMs: 300_000 } }));
  }
  if (!progress.uploaded && (!['stopped-output-retained', 'exported'].includes(String(stop.state)) || stop.allProcessesExited !== true)) {
    throw new ExecutionNodeRefusal('sandbox_not_quiesced', 409, 250);
  }
  if (!progress.uploaded) {
    const exported = await node.mutate(session, 'export', intent.exportCommandId, { spec: { buildId: intent.buildId,
      subPath: 'ui/dist', destination: intent.destination, maxBytes: intent.maxBytes } });
    if (exported.bytes.length > intent.maxBytes) throw new ExecutionNodeRefusal('export_exceeds_limit');
    const provenance = node.verifyExport(exported, session, { buildId: intent.buildId, command: intent.command });
    const url = await options.authorizeUpload(intent.destination, session.ownership.tenantId);
    options.validateUrl(url, session.ownership.tenantId);
    const target = new URL(url); target.search = '';
    if (target.href !== intent.destination) throw new ExecutionNodeRefusal('export_destination_mismatch');
    const upload = await (options.upload ?? fetch)(url, { method: 'PUT', redirect: 'error',
      body: new Uint8Array(exported.bytes), signal: AbortSignal.timeout(30_000) });
    if (!upload.ok) throw new ExecutionNodeRefusal('artifact_upload_failed');
    progress = { uploaded: { provenance, bytes: exported.bytes.length } }; await persist(progress);
  }
  // Reconcile a DELETE whose successful response was lost after the upload checkpoint.
  if (stop.state !== 'destroyed') {
    const destroyed = nodeJson(await node.mutate(session, 'delete', intent.deleteCommandId));
    if (destroyed.state !== 'destroyed' || destroyed.allProcessesExited !== true) throw new ExecutionNodeRefusal('sandbox_not_destroyed');
  }
  await persist({ ...progress, destroyed: true }); return progress.uploaded!;
}
