import { createHash, generateKeyPairSync } from 'node:crypto';
import { vi } from 'vitest';
import { createSupervisorTransport, type SupervisorSources } from '../../../src/services/artifacts/live/supervisor';
import { openFrame, type FrameBody } from '../../../src/services/artifacts/live/supervisor-frame';
import { TREE_LIMITS, treeDigest, type TransferFile } from '../../../src/services/artifacts/live/supervisor-transfer';
import type { LiveRuntime } from '../../../src/services/artifacts/live/records';

export const runtime = { generation: 1, sessionId: 'sess-1', leaseEpoch: 2, routeEpoch: 3, podName: 'artifact-' + 'a'.repeat(40),
  podUid: 'uid-1', sourceRevision: 7 } as LiveRuntime;
export const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
export const text = (path: string, value: string, mode = 0o644): TransferFile => ({ path, mode, bytes: Buffer.from(value) });
export const DIST = [text('index.html', '<main></main>'), text('assets/app.js', 'export {}')];
type Handler = (body: FrameBody, signal: AbortSignal) => unknown;
/** Async source yielding one item at a time, as the streaming cache and tarball readers do. */
export async function* stream<T>(items: readonly T[]) { for (const item of items) yield item; }
/** Refusal marker for a handler: the fake pod answers ok:false with this closed code. */
export const refuse = (code: string) => ({ __refuse: code });

/** Fake pod bootstrap: verifies every frame with the public key only, reassembles put transfers and serves output pages. */
export function fakePod(overrides: Partial<Record<FrameBody['op'], Handler>> = {}, options: { dist?: TransferFile[] } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const bodies: FrameBody[] = [];
  const transfers = new Map<string, Map<string, { mode: number; chunks: Buffer[] }>>();
  let revision: unknown = runtime.sourceRevision; let clock = 1_000;
  const received = (id: string) => [...(transfers.get(id) ?? new Map()).entries()]
    .map(([path, file]) => ({ path, mode: file.mode, bytes: Buffer.concat(file.chunks) }));
  const commit = (args: Record<string, unknown>) => ({ treeDigest: treeDigest(received(String(args.transfer)), TREE_LIMITS,
    kind => { throw new Error(kind); }) });
  const defaults: Record<FrameBody['op'], Handler> = {
    phase: body => ({ phase: body.args.phase }),
    terminate: () => ({ treeGone: true }),
    clear: body => ({ cleared: body.args.paths }),
    put: body => {
      const files = transfers.get(String(body.args.transfer)) ?? new Map(); transfers.set(String(body.args.transfer), files);
      for (const entry of body.args.entries as { path: string; mode: number; data: string }[]) {
        const file = files.get(entry.path) ?? { mode: entry.mode, chunks: [] }; files.set(entry.path, file);
        file.chunks.push(Buffer.from(entry.data, 'base64'));
      }
      return {};
    },
    stage: body => commit(body.args),
    dependencies: body => ({ ...commit(body.args), readOnly: true }),
    install: () => ({ exitCode: 0 }),
    overlay: body => { revision = body.args.revision; return { ...commit(body.args), revision }; },
    hostFile: body => ({ sha256: sha256(String(body.args.source)) }),
    prebundle: () => ({ prebundled: true }),
    dev: body => ({ revision, routeEpoch: body.fence.routeEpoch }),
    build: () => ({ exitCode: 0 }),
    snapshot: body => {
      const files = (options.dist ?? DIST).map(f => ({ path: f.path, type: 'file', mode: f.mode, size: f.bytes.length, offset: 0,
        data: Buffer.from(f.bytes).toString('base64') }));
      return body.args.cursor === 0 ? { entries: files, next: null } : { entries: [], next: null };
    },
  };
  const channel = { send: vi.fn(async (_target: unknown, frame: Uint8Array, signal: AbortSignal) => {
    const body = openFrame(publicKey, frame, clock);
    if (!body) throw new Error('unsigned frame secret-token');
    bodies.push(body);
    const data = await (overrides[body.op] ?? defaults[body.op])(body, signal) as Record<string, unknown>;
    const reply = data && '__refuse' in data ? { id: body.id, ok: false, code: data.__refuse, message: 'secret-token' }
      : { id: body.id, ok: true, data };
    return Buffer.from(JSON.stringify(reply));
  }) };
  const sources: SupervisorSources = {
    source: vi.fn(async () => [text('package-lock.json', '{"lockfileVersion":3}'), text('ui/main.ts', 'ok')]),
    draft: vi.fn(async () => ({ files: [text('ui/main.ts', 'edited')], deletes: ['ui/old.ts'] })),
    dependencies: vi.fn(() => stream([{ path: 'node_modules/vite/bin/vite.js', mode: 365 as const, bytes: Buffer.from('#!') }])),
    candidate: vi.fn(async () => undefined),
  };
  let ids = 0;
  const supervisor = createSupervisorTransport({ channel, sources, signingKey: () => privateKey, timeoutMs: 50,
    now: () => clock, id: () => `id-${++ids}` });
  return { supervisor, channel, sources, bodies, received, tick: (ms: number) => { clock += ms; },
    ops: () => bodies.map(b => b.op) };
}
