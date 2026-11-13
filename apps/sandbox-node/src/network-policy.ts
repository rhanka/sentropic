import { ExecutionNodeError } from './errors.js';

/** Only an explicit operator opt-in enables the anticipated AMD-28 mode. */
export function requireNetworkPolicy(network: unknown): void {
  if (network !== undefined && network !== 'none' && network !== 'ports') {
    throw new ExecutionNodeError('command_id_payload_mismatch', 'network must be none or ports');
  }
  if (network === 'ports' && process.env.EXECUTION_NODE_PORTS_ENABLED !== 'true') {
    throw new ExecutionNodeError('ports_disabled');
  }
}
