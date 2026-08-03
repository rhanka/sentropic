import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { env } from '../../config/env';
import { register, touchTab, evictStaleTabs, unregister } from '../../services/tab-registry';
import type { TabSource } from '../../services/tab-registry';
import {
  isKnownCoworkDevice,
  keepaliveCoworkDevice,
  registerCoworkDevice,
  unregisterCoworkDevice,
} from '../../services/cowork/device-registry';
import {
  acknowledgeLease,
  issueLease,
  listIssuedLeases,
  revokeLease,
} from '../../services/cowork/device-lease-service';
import { verifyGeneralDeviceProof } from '../../services/cowork/general-device-proof';
import { acknowledgeGeneralLeaseV2 } from '../../services/cowork/general-lease-service';
import { listPendingGeneralCalls, markGeneralCallNotDone, requireFreshAuthorityOnWake } from '../../services/cowork/general-call-service';

const DEFAULT_EXTENSION_VERSION = '0.1.0';
const DEFAULT_EXTENSION_SOURCE = 'ui/chrome-ext';
const DEFAULT_EXTENSION_ZIP_PATH = '/chrome-extension/sentropic-chrome-extension.zip';

const readConfig = () => {
  const downloadUrl = (process.env.CHROME_EXTENSION_DOWNLOAD_URL ?? env.CHROME_EXTENSION_DOWNLOAD_URL ?? '').trim();
  const version = (process.env.CHROME_EXTENSION_VERSION ?? env.CHROME_EXTENSION_VERSION ?? '').trim();
  const source = (process.env.CHROME_EXTENSION_SOURCE ?? env.CHROME_EXTENSION_SOURCE ?? '').trim();

  return {
    downloadUrl,
    version: version || DEFAULT_EXTENSION_VERSION,
    source: source || DEFAULT_EXTENSION_SOURCE,
  };
};

const normalizeHttpUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const buildFallbackDownloadUrlFromOrigin = (originHeader: string | undefined): string | null => {
  const origin = (originHeader ?? '').trim();
  if (!origin) return null;

  const normalizedOrigin = normalizeHttpUrl(origin);
  if (!normalizedOrigin) return null;

  return new URL(DEFAULT_EXTENSION_ZIP_PATH, normalizedOrigin).toString();
};

export const chromeExtensionRouter = new Hono();

// --- Tab registration / keepalive / unregister endpoints ---

const VALID_TAB_SOURCES = new Set<TabSource>(['chrome_plugin', 'bookmarklet', 'desktop_cowork']);
const issueLeaseSchema = z.object({
  device_id: z.string().uuid(),
  turn_ref: z.string().min(1).max(256),
  scope: z.record(z.unknown()).nullable().optional().default(null),
});
const acknowledgeLeaseSchema = z.object({
  device_id: z.string().uuid(),
  signature: z.string().min(1),
});
const revokeLeaseSchema = z.object({ reason: z.string().min(1).max(256) });
const generalProofSchema = z.object({
  device_id: z.string().uuid(), pep_key_id: z.string().min(1), challenge: z.string().min(1).max(256), signature: z.string().min(1),
});
const generalAckSchema = generalProofSchema.extend({
  ack: z.object({ leaseId: z.string().uuid(), leaseDigest: z.string().min(1), deviceId: z.string().uuid(), pepKeyId: z.string().min(1), surfaceEpoch: z.number().int().nonnegative(), killEpoch: z.number().int().nonnegative(), signature: z.string().min(1), version: z.literal(2) }),
});

function mutationFailure(c: Context, reason: string) {
  const status = reason === 'not_found' ? 404 : 403;
  return c.json({ message: `Cowork device mutation denied: ${reason}.` }, status);
}

chromeExtensionRouter.post('/tabs/register', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const tab_id = typeof body.tab_id === 'string' ? body.tab_id.trim() : '';
  const device_id = typeof body.device_id === 'string' ? body.device_id.trim() : '';
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const source = typeof body.source === 'string' ? body.source.trim() : '';

  if (!VALID_TAB_SOURCES.has(source as TabSource)) {
    return c.json(
      { message: 'Invalid source. Must be "chrome_plugin", "bookmarklet" or "desktop_cowork".' },
      400,
    );
  }

  if (source === 'desktop_cowork') {
    if (!device_id) return c.json({ message: 'device_id is required for desktop_cowork.' }, 400);
    const result = await registerCoworkDevice(user.userId, device_id);
    if (!result.ok) return mutationFailure(c, result.reason);
    return c.json({ ok: true, tab_id: device_id, device_id });
  }

  const entry = register({
    tab_id: tab_id || undefined,
    source: source as TabSource,
    url,
    title,
    userId: user.userId,
  });

  return c.json({ ok: true, tab_id: entry.tab_id });
});

chromeExtensionRouter.post('/tabs/keepalive', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const tab_id = typeof body.tab_id === 'string' ? body.tab_id.trim() : '';
  const device_id = typeof body.device_id === 'string' ? body.device_id.trim() : '';

  if (device_id) {
    const result = await keepaliveCoworkDevice(user.userId, device_id);
    if (!result.ok) return mutationFailure(c, result.reason);
    return c.json({ ok: true, evicted_count: 0 });
  }

  if (!tab_id) {
    return c.json({ message: 'tab_id is required.' }, 400);
  }

  touchTab(tab_id);
  const evicted = evictStaleTabs(45_000);

  return c.json({ ok: true, evicted_count: evicted.length });
});

chromeExtensionRouter.delete('/tabs/:tabId', async (c) => {
  const user = c.get('user');
  const tabId = c.req.param('tabId');
  if (await isKnownCoworkDevice(tabId)) {
    const result = await unregisterCoworkDevice(user.userId, tabId);
    if (!result.ok) return mutationFailure(c, result.reason);
    return c.json({ ok: true });
  }
  unregister(tabId);
  return c.json({ ok: true });
});

// Authorization-only BR-41c lease primitives. Lot 4 may attach a consented
// desktop execution loop after `acknowledgeLease`; this branch deliberately does not.
chromeExtensionRouter.post('/cowork-devices/leases', async (c) => {
  const parsed = issueLeaseSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ message: 'Invalid lease request.' }, 400);
  const user = c.get('user');
  const result = await issueLease({
    userId: user.userId,
    deviceId: parsed.data.device_id,
    turnRef: parsed.data.turn_ref,
    scope: parsed.data.scope,
  });
  return result.ok
    ? c.json({ ok: true, lease: result.lease }, 201)
    : c.json({ message: `Lease issuance denied: ${result.reason}.` }, 403);
});

chromeExtensionRouter.post('/cowork-devices/leases/:leaseId/ack', async (c) => {
  const parsed = acknowledgeLeaseSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ message: 'Invalid lease acknowledgement.' }, 400);
  const user = c.get('user');
  const result = await acknowledgeLease({
    userId: user.userId,
    deviceId: parsed.data.device_id,
    leaseId: c.req.param('leaseId'),
    signature: parsed.data.signature,
  });
  if (result.ok) return c.json({ ok: true, lease: result.lease });
  return c.json({ message: `Lease acknowledgement denied: ${result.reason}.` }, result.reason === 'not_found' ? 404 : 409);
});

chromeExtensionRouter.post('/cowork-devices/leases/:leaseId/revoke', async (c) => {
  const parsed = revokeLeaseSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ message: 'Invalid lease revocation.' }, 400);
  const result = await revokeLease(c.req.param('leaseId'), parsed.data.reason, c.get('user').userId);
  return result.ok
    ? c.json({ ok: true, lease: result.lease })
    : c.json({ message: `Lease revocation denied: ${result.reason}.` }, 404);
});

chromeExtensionRouter.get('/cowork-devices/:deviceId/leases', async (c) => {
  const requestedLimit = Number(c.req.query('limit') ?? 20);
  const leases = await listIssuedLeases(c.get('user').userId, c.req.param('deviceId'), requestedLimit);
  if (!leases) return c.json({ message: 'Cowork device not found.' }, 404);
  return c.json({ leases: leases.map((lease) => ({
    leaseId: lease.id,
    nonce: lease.nonce,
    scope: lease.scope,
    expiresAt: lease.expiresAt,
  })) });
});

async function requireGeneralProof(c: Context, channel: 'poll' | 'wake' | 'ack' | 'result') {
  const parsed = generalProofSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return null;
  const result = await verifyGeneralDeviceProof({
    userId: c.get('user').userId, deviceId: parsed.data.device_id, channel, challenge: parsed.data.challenge,
    proof: { channel, deviceId: parsed.data.device_id, pepKeyId: parsed.data.pep_key_id, challenge: parsed.data.challenge, signature: parsed.data.signature },
  });
  return result.ok ? { parsed: parsed.data, proof: result } : null;
}

// General-only delivery: a bearer is insufficient on every channel below.
chromeExtensionRouter.post('/cowork-general/:deviceId/poll', async (c) => {
  const verified = await requireGeneralProof(c, 'poll');
  if (!verified || verified.parsed.device_id !== c.req.param('deviceId')) return c.json({ message: 'General device proof denied.' }, 403);
  return c.json({ calls: await listPendingGeneralCalls(c.get('user').userId, verified.parsed.device_id) });
});

chromeExtensionRouter.post('/cowork-general/calls/:callRef/wake', async (c) => {
  const verified = await requireGeneralProof(c, 'wake');
  if (!verified || verified.parsed.challenge !== c.req.param('callRef')) return c.json({ message: 'General device proof denied.' }, 403);
  const call = await requireFreshAuthorityOnWake({ durableCallRef: c.req.param('callRef'), principalId: c.get('user').userId, targetDeviceId: verified.parsed.device_id });
  return call ? c.json({ call }) : c.json({ message: 'Fresh authority required.' }, 409);
});

chromeExtensionRouter.post('/cowork-general/calls/:callRef/result', async (c) => {
  const verified = await requireGeneralProof(c, 'result');
  if (!verified || verified.parsed.challenge !== c.req.param('callRef')) return c.json({ message: 'General device proof denied.' }, 403);
  // Native PEP/postcondition evidence is absent: a reported input is never FAIT.
  return c.json({ outcome: (await markGeneralCallNotDone(c.req.param('callRef'), verified.parsed.device_id)) ? 'PAS-FAIT' : 'PAS-FAIT' });
});

chromeExtensionRouter.post('/cowork-general/leases/:leaseId/ack', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = generalAckSchema.safeParse(body);
  if (!parsed.success || parsed.data.ack.leaseId !== c.req.param('leaseId')) return c.json({ message: 'Invalid General lease acknowledgement.' }, 400);
  const proof = await verifyGeneralDeviceProof({ userId: c.get('user').userId, deviceId: parsed.data.device_id, channel: 'ack', challenge: parsed.data.challenge, proof: { channel: 'ack', deviceId: parsed.data.device_id, pepKeyId: parsed.data.pep_key_id, challenge: parsed.data.challenge, signature: parsed.data.signature } });
  if (!proof.ok) return c.json({ message: 'General device proof denied.' }, 403);
  return (await acknowledgeGeneralLeaseV2({ userId: c.get('user').userId, deviceId: parsed.data.device_id, leaseId: c.req.param('leaseId'), ack: parsed.data.ack, pepPublicKey: proof.device.pepPublicKey }))
    ? c.json({ ok: true }) : c.json({ message: 'General lease acknowledgement denied.' }, 409);
});

// --- Download endpoint ---

chromeExtensionRouter.get('/download', async (c) => {
  const config = readConfig();

  let resolvedDownloadUrl: string | null = null;

  if (config.downloadUrl) {
    resolvedDownloadUrl = normalizeHttpUrl(config.downloadUrl);
    if (!resolvedDownloadUrl) {
      return c.json(
        {
          message:
            'Chrome extension download is unavailable: CHROME_EXTENSION_DOWNLOAD_URL must be a valid http(s) URL, then restart the API.',
        },
        503
      );
    }
  } else {
    resolvedDownloadUrl = buildFallbackDownloadUrlFromOrigin(c.req.header('origin'));
    if (!resolvedDownloadUrl) {
      return c.json(
        {
          message:
            'Chrome extension download is unavailable: set CHROME_EXTENSION_DOWNLOAD_URL in the API environment and restart the API.',
        },
        503
      );
    }
  }

  return c.json({
    version: config.version,
    source: config.source,
    downloadUrl: resolvedDownloadUrl,
  });
});
