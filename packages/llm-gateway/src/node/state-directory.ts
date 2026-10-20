import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/** Resolve a private application-state path without opening any owner files. */
export const resolveGatewayStateDir = (options: { ownerScopeRef: string; platformDir?: string }): string => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(options.ownerScopeRef)) {
    throw new Error('ownerScopeRef must be an opaque scope segment');
  }
  const base = options.platformDir ?? (process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support')
    : process.platform === 'win32'
      ? process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
      : process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'));
  if (!isAbsolute(base)) throw new Error('application-state directory must be absolute');
  return join(base, 'sentropic', 'llm-gateway', options.ownerScopeRef);
};
