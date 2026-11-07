import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_SOURCE } from '../../../src/services/artifacts/live/bootstrap-agent';
import {
  BUILD_RECIPE, INSTALL_RECIPE, LIVE_PREBUNDLE_SCRIPT, LIVE_RECIPE, PREBUNDLE_RECIPE, artifactEnvironment, buildEnvironment,
} from '../../../src/services/artifacts/live/recipes';

/** Loads the pod agent exactly as the bootstrap embeds it (a plain JavaScript module string). */
let loaded: Promise<any> | undefined;
export const agentModule = () => loaded ??= import(/* @vite-ignore */
  `data:text/javascript;base64,${Buffer.from(AGENT_SOURCE).toString('base64')}`);
export const recipes = { install: INSTALL_RECIPE, prebundle: PREBUNDLE_RECIPE, prebundleScript: LIVE_PREBUNDLE_SCRIPT,
  live: LIVE_RECIPE, build: BUILD_RECIPE };
export const POD = { podName: `artifact-${'a'.repeat(40)}`, podUid: '7c0e5a52-1d1b-4c55-9f3e-0a1b2c3d4e5f' };
export const fence = (routeEpoch = 1, leaseEpoch = 1, sessionId = 's1', generation = 1) =>
  ({ generation, sessionId, leaseEpoch, routeEpoch, ...POD });
export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const b64 = (value: string | Uint8Array) => Buffer.from(value).toString('base64');
/** W3 wire frame: the 64-byte Ed25519 signature, then the exact UTF-8 JSON body it signs. */
export const seal = (key: KeyObject, body: unknown) => {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  return Buffer.concat([sign(null, bytes, key), bytes]);
};
export interface TreeFile { path: string; mode: number; bytes: Buffer }
export const file = (path: string, value: string | Buffer, mode = 0o644): TreeFile => ({ path, mode, bytes: Buffer.from(value) });
/** Same digest as W3 `treeDigest`: [path, mode, size, sha256] sorted by path (UTF-16 code units). */
export const treeDigest = (files: readonly TreeFile[]) => sha256(JSON.stringify(files
  .map(f => [f.path, f.mode, f.bytes.length, sha256(f.bytes)]).sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1))));

export interface Spawned { executable: string; args: string[]; options: any }
/** A fake child that exits with `code` after running `effect` (for example, writing install output). */
export function fakeSpawn(calls: Spawned[], effect: (call: Spawned) => Promise<number | void> = async () => 0) {
  return (executable: string, args: string[], options: any) => {
    const call = { executable, args, options }; calls.push(call);
    const child: any = new EventEmitter(); child.pid = 4000 + calls.length;
    setImmediate(async () => { const code = await effect(call); child.emit('exit', typeof code === 'number' ? code : 0, null); });
    return child;
  };
}

export async function harness(options: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'w4-pod-'));
  for (const dir of ['workspace', 'dependencies', 'tmp']) await mkdir(join(root, dir));
  const keys = generateKeyPairSync('ed25519');
  const clock = { now: 1_000_000 };
  const killed: number[] = []; const groups: number[] = []; const exits: number[] = [];
  const { createAgent } = await agentModule();
  const agent = createAgent({ root, recipes, env: artifactEnvironment(), buildEnv: buildEnvironment(), settleMs: 1,
    publicKey: keys.publicKey, identity: POD,
    now: () => clock.now, exit: (code: number) => { exits.push(code); },
    spawn: () => { throw new Error('spawn not expected'); },
    processes: { list: async () => [], kill: (pid: number) => { killed.push(pid); }, killGroup: (pgid: number) => { groups.push(pgid); } },
    sockets: async () => [], waitPort: async () => undefined, ...options });
  let ids = 0;
  const body = (op: string, args: Record<string, unknown> = {}, at = fence()) =>
    ({ v: 1, id: `f-${++ids}`, op, fence: at, issuedAt: clock.now, expiresAt: clock.now + 30_000, args });
  /** Raw reply object, or null when the pod refused the frame before any operation. */
  const deliver = async (frame: Buffer) => {
    const reply = await agent.receive(frame);
    return reply === null ? null : JSON.parse(Buffer.from(reply).toString('utf8'));
  };
  const send = async (op: string, args: Record<string, unknown> = {}, at = fence()) => {
    const frame = body(op, args, at);
    const reply = await deliver(seal(keys.privateKey, frame));
    if (!reply) throw new Error('frame_refused');
    if (reply.id !== frame.id) throw new Error('reply_unbound');
    if (!reply.ok) throw new Error(`${reply.code}:${reply.reason}`);
    return reply.data;
  };
  /** Pushes a tree as the W3 supervisor does: bounded put frames by offset; returns the commit arguments. */
  const transfer = async (target: string, files: readonly TreeFile[], chunk = 768 * 1024, at = fence()) => {
    const id = `t-${++ids}`;
    for (const f of files) {
      let offset = 0;
      do {
        const slice = f.bytes.subarray(offset, offset + chunk);
        await send('put', { transfer: id, target, entries: [{ path: f.path, mode: f.mode, size: f.bytes.length, offset,
          data: b64(slice) }] }, at);
        offset += slice.length;
      } while (offset < f.bytes.length);
    }
    return { transfer: id, treeDigest: treeDigest(files) };
  };
  return { root, agent, keys, clock, killed, groups, exits, body, deliver, send, transfer,
    path: (...parts: string[]) => join(root, ...parts) };
}
