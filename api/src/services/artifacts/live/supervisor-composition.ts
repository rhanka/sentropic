import type { SigningKey } from '@sentropic/artifacts/live-host';
import { createBootstrapSource } from './bootstrap';
import { createSupervisorTransport, type SupervisorOptions } from './supervisor';
import { supervisorPublicKey } from './supervisor-frame';

/** FIX5 (s-archi 16:40): one supervisor key (`supervisorKey(process.env)`) both signs every frame and yields the only
 * public key the pod bootstrap embeds, so a pod accepts frames from this API and from no other key. */
export function composeSupervisor(options: Omit<SupervisorOptions, 'signingKey'> & { key: SigningKey }) {
  const { key, ...transport } = options;
  return { bootstrap: createBootstrapSource(supervisorPublicKey(key.key)),
    supervisor: createSupervisorTransport({ ...transport, signingKey: () => key.key }) };
}
