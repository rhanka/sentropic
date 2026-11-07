import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_SOURCE } from '../../../src/services/artifacts/live/bootstrap-agent';
import {
  BUILD_RECIPE, INSTALL_RECIPE, LIVE_RECIPE, PREBUNDLE_RECIPE, artifactEnvironment,
} from '../../../src/services/artifacts/live/recipes';

/** Loads the pod agent exactly as the bootstrap embeds it (a plain JavaScript module string). */
let loaded: Promise<any> | undefined;
export const agentModule = () => loaded ??= import(/* @vite-ignore */
  `data:text/javascript;base64,${Buffer.from(AGENT_SOURCE).toString('base64')}`);
export const recipes = { INSTALL: INSTALL_RECIPE, PREBUNDLE: PREBUNDLE_RECIPE, LIVE: LIVE_RECIPE, BUILD: BUILD_RECIPE };
export const b64 = (value: string | Uint8Array) => Buffer.from(value).toString('base64');
export const fence = (routeEpoch = 1, leaseEpoch = 1, sessionId = 's1', generation = 1) =>
  ({ generation, sessionId, leaseEpoch, routeEpoch });

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
  const killed: number[] = [];
  const { createAgent } = await agentModule();
  const agent = createAgent({ root, recipes, env: artifactEnvironment(), settleMs: 1,
    spawn: () => { throw new Error('spawn not expected'); },
    processes: { list: async () => [], kill: (pid: number) => { killed.push(pid); } },
    sockets: async () => [], waitPort: async () => undefined, ...options });
  let seq = 0;
  const send = (op: string, args: Record<string, unknown> = {}, at = fence()) =>
    agent.handle({ id: `cmd-${++seq}`, seq, fence: at, op, args });
  return { root, agent, killed, send, path: (...parts: string[]) => join(root, ...parts) };
}
