import { LiveError } from './records';
import { verifySri, type IntegrityPin } from './integrity';
import { NPM_RELAY } from './recipes';

/** Relay-only bounded fetch, with no URL fallback, credentials, redirect or unqualified first download. */
export async function fetchLockedTarball(pin: IntegrityPin, relay: typeof NPM_RELAY = NPM_RELAY,
  transport: typeof fetch = fetch, signal?: AbortSignal): Promise<Uint8Array> {
  const url = new URL(pin.url);
  if (relay !== NPM_RELAY || url.origin !== 'https://registry.npmjs.org' || url.username || url.password || url.search || url.hash
    || url.pathname.startsWith('//')) {
    throw new LiveError('dependency_integrity_missing');
  }
  const target = new URL(relay);
  target.pathname = url.pathname;
  // The watchdog abort joins the per-fetch 30 s timeout, so a cut install stops holding the relay.
  const combined = signal ? AbortSignal.any([AbortSignal.timeout(30_000), signal]) : AbortSignal.timeout(30_000);
  let response: Response;
  try {
    response = await transport(target, {
      redirect: 'error', headers: { 'accept-encoding': 'identity' }, signal: combined,
    });
  } catch { throw new LiveError('builder_unavailable', 'npm_relay_unreachable'); }
  if (response.status !== 200 || !response.body) throw new LiveError('builder_unavailable', `npm_relay_${response.status}`);
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    combined.throwIfAborted();
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.length;
    if (size > 64 * 1024 * 1024) { await reader.cancel(); throw new LiveError('limit_exceeded'); }
    chunks.push(chunk.value);
  }
  const bytes = Buffer.concat(chunks); verifySri(bytes, pin.integrity); return bytes;
}
