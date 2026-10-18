/**
 * Process entry of the standalone gateway host. `node apps/llm-gateway/dist/index.js`
 * is the B5 target: no build emits `dist/` yet (BR900-A4).
 * B1 wires no identity (B2), settlement (B3c) or routing (B4) adapter yet: the
 * process listens, `/healthz` is live, `/readyz` stays 503 and admission refuses.
 * It runs no migration and holds no fallback (no stub, file or in-memory store).
 */
import { pathToFileURL } from 'node:url';

import { createHostApp, startDurableGatewayApp, type HostDependencies } from './app';
import type { StartGatewayHostOptions, GatewayHostHandle } from '@sentropic/llm-gateway/node';
import { loadHostConfig } from './config';
import { handleShutdownSignals, startHost, type RunningHost } from './lifecycle';

export interface MainOptions {
  readonly durable?: Omit<StartGatewayHostOptions, 'listen'>;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly dependencies?: HostDependencies;
  readonly log?: (line: string) => void;
}

export function main(options: MainOptions & { durable: NonNullable<MainOptions['durable']> }): Promise<GatewayHostHandle & { port: number }>;
export function main(options?: MainOptions): Promise<RunningHost>;
export async function main(options: MainOptions = {}): Promise<RunningHost | (GatewayHostHandle & { port: number })> {
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const config = loadHostConfig(options.env ?? process.env);
  if (options.durable) {
    const host = await startDurableGatewayApp(config, options.durable);
    const port = Number(new URL(host.endpoint).port);
    log(`llm-gateway-host listening port=${port} durable=true`);
    return { ...host, port };
  }
  const host = await createHostApp({
    config,
    dependencies: options.dependencies ?? {},
    onProbeFailure: (name, failure) => log(`llm-gateway-host readiness probe=${name} failure=${failure}`),
  });
  const running = await startHost(host, config, { log });
  log(`llm-gateway-host listening port=${running.port} pending=${host.pending.join(',') || 'none'}`);
  return running;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (import.meta.url === entry) {
  main().then(
    (running) => handleShutdownSignals(process, running, (code) => process.exit(code)),
    (error: unknown) => {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'startup_failed';
      process.stderr.write(`llm-gateway-host startup refused code=${code}\n`);
      process.exit(1);
    },
  );
}
