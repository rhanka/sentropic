import { request as httpRequest } from 'node:http';
import type { LookupFunction } from 'node:net';
import { LiveError } from './records';
import type { SupervisorChannel } from './supervisor-channel';
import { MAX_FRAME_BYTES, MAX_REPLY_BYTES } from './supervisor-frame';

/** A-LIVE §8.1: artifact-content is the workers' only ingress, so every supervisor frame rides its internal relay route. */
export const SUPERVISOR_RELAY_PATH = '/_live-supervisor/v1/';
/** Per-environment relay base URL (not secret), e.g. http://artifact-content.sentropic-preprod.svc.cluster.local:8791. */
export const SUPERVISOR_RELAY_URL_ENV = 'ARTIFACT_SUPERVISOR_RELAY_URL';
/** Composed supervisor command bound: above the pod's longest command (~300 s), below the relay upstream bound (330 s). */
export const SUPERVISOR_COMMAND_TIMEOUT_MS = 320_000;
const POD = /^artifact-[a-f0-9]{40}$/;
const SERVICE_HOST = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?\.[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?\.svc\.cluster\.local$/;
function unconfigured(): never { throw new LiveError('builder_unavailable', 'relay_unconfigured'); }

/** http only, no credentials, query, fragment or path, host `<service>.<namespace>.svc.cluster.local`. */
function relayBase(value: string | undefined): URL {
  if (!value || /[?#@]/.test(value)) unconfigured();
  let url: URL;
  try { url = new URL(value); } catch { return unconfigured(); }
  if (url.protocol !== 'http:' || url.pathname !== '/' || !SERVICE_HOST.test(url.hostname)) unconfigured();
  return url;
}
/** Relay URL of this environment; an absent or invalid value refuses to compose the live service. */
export function supervisorRelayUrl(env: Readonly<Record<string, string | undefined>>): string {
  const value = env[SUPERVISOR_RELAY_URL_ENV];
  relayBase(value);
  return value as string;
}

/**
 * One frame per POST to `<baseUrl>/_live-supervisor/v1/<podName>` (raw bytes, octet-stream, internal Service Host).
 * node:http with a fresh connection and no client timeout: the pod replies only when a command ends (up to ~300 s),
 * which undici fetch would cut at its default 300 s headers timeout. The caller's signal is the only bound.
 * 200 → the raw reply (≤ MAX_REPLY_BYTES); any other status, an oversized reply or a network error → builder_unavailable.
 * `lookup` is a test seam for the Service DNS resolution.
 */
export function createRelaySupervisorChannel(options: { baseUrl: string; lookup?: LookupFunction }): SupervisorChannel {
  const base = relayBase(options.baseUrl);
  return {
    send(target, frame, signal) {
      return new Promise<Uint8Array>((resolve, reject) => {
        const fail = () => reject(new LiveError('builder_unavailable'));
        if (!POD.test(target.podName) || frame.byteLength > MAX_FRAME_BYTES || signal.aborted) return fail();
        const outgoing = httpRequest({ hostname: base.hostname, port: base.port || 80, method: 'POST', agent: false,
          path: SUPERVISOR_RELAY_PATH + target.podName, lookup: options.lookup, signal,
          headers: { 'content-type': 'application/octet-stream', 'content-length': String(frame.byteLength) } }, response => {
          const declared = Number(response.headers['content-length'] ?? 0);
          if (response.statusCode !== 200 || declared > MAX_REPLY_BYTES) { outgoing.destroy(); return fail(); }
          const chunks: Buffer[] = []; let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_REPLY_BYTES) { outgoing.destroy(); fail(); } else chunks.push(chunk);
          });
          response.once('end', () => { if (size <= MAX_REPLY_BYTES) resolve(Buffer.concat(chunks)); });
          response.once('error', fail);
          response.once('close', () => { if (!response.complete) fail(); });
        });
        outgoing.once('error', fail);
        outgoing.end(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
      });
    },
  };
}
