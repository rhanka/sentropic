import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';

import type {
  ActuationRequest,
  ActuationResult,
  PtyActuatorPort,
  SessionTargetStatePort,
} from '@sentropic/cluster-mesh';

type NativeState = {
  id: string;
  generation: string;
  incarnation: string;
  status: 'running' | 'stopping' | 'exited';
  latestSeq: number;
};

type NativeLease = {
  role: 'controller';
  id: string;
  generation: string;
  incarnation: string;
  controllerId: string;
  epoch: number;
};

class NativeClient {
  private buffer = '';

  private constructor(private readonly socket: Socket) {}

  static async connect(path: string): Promise<NativeClient> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(path);
      const timeout = setTimeout(() => socket.destroy(new Error('native socket connect timeout')), 1_000);
      timeout.unref();
      socket.once('error', reject);
      socket.once('connect', () => {
        clearTimeout(timeout);
        socket.removeListener('error', reject);
        socket.setEncoding('utf8');
        resolve(new NativeClient(socket));
      });
    });
  }

  request<T>(operation: string, params?: Record<string, unknown>): Promise<T> {
    const id = randomUUID();
    const frame = `${JSON.stringify({ version: 1, id, operation, ...(params ? { params } : {}) })}\n`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error(`native ${operation} timeout`)), 5_000);
      timeout.unref();
      const finish = (error?: Error, value?: T) => {
        clearTimeout(timeout);
        this.socket.removeListener('data', onData);
        this.socket.removeListener('error', onError);
        if (error) reject(error);
        else resolve(value as T);
      };
      const onError = (error: Error) => finish(error);
      const onData = (chunk: string) => {
        this.buffer += chunk;
        const newline = this.buffer.indexOf('\n');
        if (newline < 0) return;
        const raw = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        try {
          const response = JSON.parse(raw) as {
            version: number; id: string; ok: boolean; result?: T; error?: { message?: string };
          };
          if (response.version !== 1 || response.id !== id) throw new Error('invalid native response');
          finish(response.ok ? undefined : new Error(response.error?.message ?? 'native operation failed'), response.result);
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      };
      this.socket.on('data', onData);
      this.socket.once('error', onError);
      this.socket.write(frame, (error) => { if (error) finish(error); });
    });
  }

  close() { this.socket.destroy(); }
}

export const LIVE_H2A_ACTUATOR_REF = 'h2a-pty:v1:cm-a1-e2e-target';
const targetId = LIVE_H2A_ACTUATOR_REF.slice('h2a-pty:v1:'.length);

export function createLiveH2aPorts(input: { socketPath: string; root: string }) {
  const withClient = async <T>(run: (client: NativeClient) => Promise<T>) => {
    const client = await NativeClient.connect(input.socketPath);
    try { return await run(client); } finally { client.close(); }
  };
  const state = () => withClient((client) => client.request<NativeState>('state', { id: targetId }));
  const validate = async () => {
    const registry = JSON.parse(await readFile(`${input.root}/registry.json`, 'utf8')) as {
      entries?: Array<{ id?: string }>;
    };
    if (!registry.entries?.some(({ id }) => id === `native-terminal-pty:${targetId}`)) {
      throw new Error('live h2a target is absent from H2A_ROOT registry');
    }
    const current = await state();
    if (current.status !== 'running') throw new Error('live h2a target is not running');
    return current;
  };
  const pty: PtyActuatorPort = {
    kind: 'pty',
    async isAvailable(ref) {
      if (ref !== LIVE_H2A_ACTUATOR_REF) return false;
      try { return (await state()).status === 'running'; } catch { return false; }
    },
    actuate(request: ActuationRequest): Promise<ActuationResult> {
      return withClient(async (client) => {
        const before = await client.request<NativeState>('state', { id: targetId });
        if (before.status !== 'running') throw new Error('native target is not running');
        const lease = await client.request<NativeLease>('acquire-controller', {
          id: targetId, controllerId: `cluster-mesh-${request.commandRef}`, activity: 'automation',
        });
        await client.request('write', { lease, data: `${request.action}:${request.commandRef}` });
        await client.request('release-controller', { lease });
        const ticked = await client.request<NativeState>('state', { id: targetId });
        let observed = ticked;
        if (request.action === 'relaunch') {
          await client.request('stop-if-incarnation', {
            id: targetId, generation: ticked.generation, incarnation: ticked.incarnation,
          });
          observed = await client.request<NativeState>('create', {
            id: targetId, command: 'sleep', args: ['infinity'], cwd: '/tmp', env: {}, cols: 80, rows: 24,
          });
        }
        const signature = createHash('sha256').update([
          request.action, before.generation, before.incarnation, String(ticked.latestSeq), observed.incarnation,
        ].join('\0')).digest('hex').slice(0, 24);
        return {
          effectRef: `h2a-pty:acted:${request.action}:${signature}`,
          actedTargets: [request.registration.registrationId],
        };
      });
    },
  };
  const targets: SessionTargetStatePort = {
    async inspect(ref) {
      if (ref !== LIVE_H2A_ACTUATOR_REF) return 'unknown';
      try {
        const current = await state();
        return current.status === 'running' ? 'alive' : current.status === 'stopping' ? 'parked' : 'dead';
      } catch { return 'dead'; }
    },
  };
  const stop = () => withClient(async (client) => {
    const current = await client.request<NativeState>('state', { id: targetId });
    return client.request<NativeState>('stop-if-incarnation', {
      id: targetId, generation: current.generation, incarnation: current.incarnation,
    });
  });
  return { pty, targets, state, stop, validate };
}
