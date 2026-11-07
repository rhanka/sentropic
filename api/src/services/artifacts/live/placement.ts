import { LiveError } from './records';

/** Per-environment worker placement (K1 preprod and prod use separate worker namespaces). Never hard-coded:
 * the Kubernetes paths, the pod and service namespace and the Vite allowed host all derive from this value. */
export interface BuilderPlacement { readonly namespace: string; readonly serviceDomain: string }
const LABEL = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

export function builderPlacement(env: Readonly<Record<string, string | undefined>>): BuilderPlacement {
  const namespace = env.ARTIFACT_BUILDER_NAMESPACE ?? '';
  const serviceDomain = env.ARTIFACT_BUILDER_SERVICE_DOMAIN ?? '';
  if (!LABEL.test(namespace) || serviceDomain.length > 253 || !serviceDomain.startsWith(`${namespace}.svc.`)
    || !serviceDomain.split('.').every(label => LABEL.test(label))) throw new LiveError('builder_unavailable', 'placement_unconfigured');
  return Object.freeze({ namespace, serviceDomain });
}
