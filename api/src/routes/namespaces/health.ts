import {
  createHealthNamespaceModule,
  type HealthProbePort,
  type HealthStatePort,
} from '@sentropic/cluster-mesh';

import {
  createHealthAuthorFence,
  healthAuthorFence,
  type HealthCutoverControl,
} from './health-cutover';
import { productDatabaseHealthProbe } from './health-product-probes';

export { HEALTH_PATHS, HEALTH_ROUTES } from '@sentropic/cluster-mesh';
export { HEALTH_AUTHOR } from './health-cutover';
export type { HealthCutoverControl } from './health-cutover';

export interface CreateProductHealthNamespaceModuleOptions {
  readonly state: HealthStatePort;
  readonly probes?: readonly HealthProbePort[];
  readonly enabled?: boolean;
  readonly cutoverControl?: HealthCutoverControl;
}

export const createProductHealthNamespaceModule = (
  options: CreateProductHealthNamespaceModuleOptions,
) => createHealthNamespaceModule({
  state: options.state,
  probes: options.probes ?? [productDatabaseHealthProbe],
  enabled: options.enabled,
  beforeProbe: options.cutoverControl
    ? createHealthAuthorFence(options.cutoverControl)
    : healthAuthorFence,
});
