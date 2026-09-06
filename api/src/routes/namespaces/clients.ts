import { Hono } from 'hono';

export const CLIENT_ROUTES = [
  ['GET', '/chrome-extension/download'],
  ['POST', '/chrome-extension/tabs/register'],
  ['POST', '/chrome-extension/tabs/keepalive'],
  ['DELETE', '/chrome-extension/tabs/:tabId'],
  ['GET', '/vscode-extension/download'],
  ['GET', '/vscode-extension/code-agent-prompt-profile'],
  ['GET', '/vscode-extension/workspace-mapping'],
  ['PUT', '/vscode-extension/workspace-mapping'],
  ['POST', '/vscode-extension/workspace-mapping/code-workspace'],
  ['POST', '/vscode-extension/workspace-mapping/not-now'],
  ['GET', '/cowork-desktop/download'],
  ['GET', '/cowork-desktop/channel'],
  ['PUT', '/cowork-desktop/channel'],
  ['GET', '/settings/vscode-extension-token'],
  ['POST', '/settings/vscode-extension-token'],
  ['DELETE', '/settings/vscode-extension-token'],
] as const;

export const CLIENT_PATHS = [...new Set(CLIENT_ROUTES.map(([, path]) => path))];

export const CLIENT_ADMIN_PATHS = [
  '/cowork-desktop/channel',
  '/settings/vscode-extension-token',
] as const;

export const CLIENT_EDITOR_PATHS = [
  '/vscode-extension/workspace-mapping/code-workspace',
] as const;

export interface ClientRouterPort {
  createRouter(): Hono;
}

export interface ClientsNamespacePorts {
  readonly chrome: ClientRouterPort;
  readonly vscode: ClientRouterPort;
  readonly cowork: ClientRouterPort;
  readonly tabs: ClientRouterPort;
  readonly authClient: ClientRouterPort;
}

const assertClientsPorts = (ports: ClientsNamespacePorts): void => {
  if (!ports.chrome?.createRouter
    || !ports.vscode?.createRouter
    || !ports.cowork?.createRouter
    || !ports.tabs?.createRouter
    || !ports.authClient?.createRouter) {
    throw new Error('client product ports are unavailable');
  }
};

export const createClientsTransportRouter = (ports: ClientsNamespacePorts): Hono => {
  assertClientsPorts(ports);
  return new Hono()
    .route('/chrome-extension', ports.chrome.createRouter())
    .route('/chrome-extension/tabs', ports.tabs.createRouter())
    .route('/vscode-extension', ports.vscode.createRouter())
    .route('/cowork-desktop', ports.cowork.createRouter())
    .route('/settings', ports.authClient.createRouter());
};
