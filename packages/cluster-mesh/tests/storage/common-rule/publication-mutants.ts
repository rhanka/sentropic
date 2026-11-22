// Faults alter the named reference decision; test stimuli and measured effects remain intact.
import { createPublicationReference, type PublicationFault } from './publication-reference.js';
const controls: readonly [PublicationFault, string, RegExp][] = [
  ['M04', 'CT-04', /CT-04: diagnostic IDs stay unpublished/],
  ['M05', 'CT-05', /CT-05: original receipt survives commit crash/],
  ['M05-unsealed', 'CT-05', /CT-05: unsealed intent cannot publish/],
  ['M06', 'CT-06', /CT-06: concurrent retries produce one effect/],
  ['M14', 'CT-14', /CT-14: old mutation is refused/],
  ['M14-parity', 'CT-14/parity', /CT-14\/parity: missing proof prevents activation/],
  ['M14-delta', 'CT-14/inventory', /CT-14\/delta: changed bytes are revalidated/],
  ['M14-namespace', 'CT-14/namespace', /CT-14\/namespace: legacy put\/collect\/delete denied/],
];
export const PUBLICATION_MUTANTS = controls.map(([id, target, kill]) => ({
  id, revision: 'l01b2-v2', target, kill, factory: () => createPublicationReference(undefined, id),
}));
