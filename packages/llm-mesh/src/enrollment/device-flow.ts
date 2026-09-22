// @sentropic/llm-mesh/enrollment/device-flow.ts
//
// Shared RFC 8628 device-authorization poll loop, mutualized across
// providers (muse native device flow; codex keeps its own custom flow until
// a dedicated refactor — enrollment/codex.ts is out of scope here).
// HTTP stays with the caller via `poll`; this module only owns the
// wait/backoff/fail-up policy. Sleeps are injectable so tests never wait.

export interface DeviceTokenGrant {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  [key: string]: unknown;
}

export type DevicePollOutcome =
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'denied'; error?: string }
  | { status: 'expired' }
  | { status: 'complete'; payload: DeviceTokenGrant };

export interface DeviceFlowPollOptions {
  poll: () => Promise<DevicePollOutcome>;
  pollIntervalMs: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  isCancelled?: () => boolean;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => { setTimeout(resolve, ms); });

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

export async function runDeviceFlowUntilComplete(
  options: DeviceFlowPollOptions,
): Promise<Required<Pick<DeviceTokenGrant, 'access_token'>> & DeviceTokenGrant> {
  const {
    poll,
    pollIntervalMs,
    maxAttempts = 60,
    sleep = defaultSleep,
    isCancelled,
  } = options;
  let intervalMs = pollIntervalMs;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (isCancelled?.()) {
      throw new Error('Device flow enrollment was cancelled');
    }
    const outcome = await poll();
    switch (outcome.status) {
      case 'complete': {
        const token = textOf(outcome.payload.access_token);
        if (!token) {
          throw new Error('Device flow completed without an access token');
        }
        return { ...outcome.payload, access_token: token };
      }
      case 'denied':
        throw new Error(
          `Device flow denied${outcome.error ? `: ${outcome.error}` : ''}`,
        );
      case 'expired':
        throw new Error('Device flow expired before approval');
      case 'slow_down':
        await sleep(intervalMs);
        intervalMs *= 2;
        break;
      case 'pending':
      default:
        await sleep(intervalMs);
        break;
    }
  }
  throw new Error(`Device flow did not complete after ${maxAttempts} attempts`);
}
