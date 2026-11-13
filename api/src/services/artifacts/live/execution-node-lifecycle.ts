import { ExecutionNodeAdapter, nodeJson, type NodeSession } from './execution-node-adapter';
import { ExecutionNodeRefusal } from './execution-node-transport';

/** D5-M1. Persist these command ids and upload destination with the build intent before calling.
 * The shipped agent returns gzip bytes + JWS; API verifies before using its presigned PUT URL.
 * Delete occurs only after confirmed upload. A failed export/upload retains output for retry.
 */
export async function exportRetainedBuild(node: ExecutionNodeAdapter, session: NodeSession, intent: {
  buildId: string; stopCommandId: string; exportCommandId: string; deleteCommandId: string;
  presignedPutUrl: string; maxBytes: number;
}, options: { validateUrl(url: string, tenantId: string): void; upload?: typeof fetch }) {
  options.validateUrl(intent.presignedPutUrl, session.ownership.tenantId);
  if (!intent.buildId || !Number.isSafeInteger(intent.maxBytes) || intent.maxBytes < 1 || intent.maxBytes > 64 * 1024 * 1024) {
    throw new ExecutionNodeRefusal('invalid_export_intent');
  }
  let stop = await node.status(session);
  if (!stop) throw new ExecutionNodeRefusal('sandbox_not_found', 404);
  if (stop.state === 'running' || stop.state === 'stopping') {
    stop = nodeJson(await node.mutate(session, 'stop', intent.stopCommandId,
      { stop: { retainOutput: true, outputSubPath: 'ui/dist', retentionTtlMs: 300_000 } }));
  }
  if (!['stopped-output-retained', 'exported'].includes(String(stop.state)) || stop.allProcessesExited !== true) {
    throw new ExecutionNodeRefusal('sandbox_not_quiesced', 409, 250);
  }
  const exported = await node.mutate(session, 'export', intent.exportCommandId, { spec: { buildId: intent.buildId,
    subPath: 'ui/dist', presignedPutUrl: intent.presignedPutUrl, maxBytes: intent.maxBytes } });
  if (exported.bytes.length > intent.maxBytes) throw new ExecutionNodeRefusal('export_exceeds_limit');
  const provenance = node.verifyExport(exported, session);
  const upload = await (options.upload ?? fetch)(intent.presignedPutUrl, { method: 'PUT', redirect: 'error',
    body: new Uint8Array(exported.bytes), signal: AbortSignal.timeout(30_000) });
  if (!upload.ok) throw new ExecutionNodeRefusal('artifact_upload_failed');
  const destroyed = nodeJson(await node.mutate(session, 'delete', intent.deleteCommandId));
  if (destroyed.state !== 'destroyed' || destroyed.allProcessesExited !== true) throw new ExecutionNodeRefusal('sandbox_not_destroyed');
  return { provenance, bytes: exported.bytes.length };
}
