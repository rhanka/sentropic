import { createProductAISettingsRouter } from './config-product-ai';
import { createProductBusinessConfigRouter } from './config-product-business';
import { createProductSettingsConfigRouter } from './config-product-settings';
import { createProductWorkspaceConfigRouter } from './config-product-workspace';
import type { ConfigNamespacePorts } from './config';

export const productConfigPorts: ConfigNamespacePorts = {
  settings: { createRouter: createProductSettingsConfigRouter },
  business: { createRouter: createProductBusinessConfigRouter },
  ai: { createRouter: createProductAISettingsRouter },
  workspace: { createRouter: createProductWorkspaceConfigRouter },
};
