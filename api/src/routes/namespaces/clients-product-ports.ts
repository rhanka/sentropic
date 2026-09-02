import { clientSettingsRouter } from './clients-product-auth';
import {
  clientTabsRouter,
  chromeExtensionRouter,
} from './clients-product-chrome';
import { coworkDesktopRouter } from './clients-product-cowork';
import { vscodeExtensionRouter } from './clients-product-vscode';
import type { ClientsNamespacePorts } from './clients';

export const productClientsPorts: ClientsNamespacePorts = {
  chrome: { createRouter: () => chromeExtensionRouter },
  vscode: { createRouter: () => vscodeExtensionRouter },
  cowork: { createRouter: () => coworkDesktopRouter },
  tabs: { createRouter: () => clientTabsRouter },
  authClient: { createRouter: () => clientSettingsRouter },
};
