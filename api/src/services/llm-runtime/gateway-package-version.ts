import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGatewayRouter } from '@sentropic/llm-gateway';

export const GATEWAY_PACKAGE_NAME = '@sentropic/llm-gateway';
export interface GatewayVersionLoader {
  resolve(): string;
  load(entry: string): Promise<{ createGatewayRouter?: unknown }>;
  read(path: string): Promise<string>;
}
const loader: GatewayVersionLoader = {
  resolve: () => import.meta.resolve(GATEWAY_PACKAGE_NAME),
  load: entry => import(entry),
  read: path => readFile(path, 'utf8'),
};
const validVersion = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 128) return false;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(value);
  return !!match && match.slice(1, 4).every(part => Number.isSafeInteger(Number(part)))
    && (!match[4] || match[4].split('.').every(part => part.length > 0 && (!/^\d+$/.test(part) || /^(0|[1-9]\d*)$/.test(part))))
    && (!match[5] || match[5].split('.').every(part => part.length > 0));
};

/** Resolve the instance actually used by this API loader; bundled copies cannot borrow an external manifest. */
export const resolveGatewayPackageVersion = async (source: GatewayVersionLoader = loader): Promise<string | undefined> => {
  try {
    const entry = source.resolve();
    if (!entry.startsWith('file:') || (await source.load(entry)).createGatewayRouter !== createGatewayRouter) return undefined;
    let directory = dirname(fileURLToPath(entry));
    for (let depth = 0; depth < 32; depth++) {
      let text: string;
      try { text = await source.read(join(directory, 'package.json')); }
      catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') return undefined;
        const parent = dirname(directory);
        if (parent === directory) return undefined;
        directory = parent;
        continue;
      }
      const manifest = JSON.parse(text) as { name?: unknown; version?: unknown };
      return manifest.name === GATEWAY_PACKAGE_NAME && validVersion(manifest.version) ? manifest.version : undefined;
    }
  } catch { /* No exception prose/path or workspace fallback can become running-version proof. */ }
  return undefined;
};

export const gatewayStartupRecord = (version: string | undefined, nativeMessagesEnabled: boolean) => Object.freeze({
  packageName: GATEWAY_PACKAGE_NAME, resolvedVersion: version ?? 'version_unverified', nativeMessagesEnabled,
});
