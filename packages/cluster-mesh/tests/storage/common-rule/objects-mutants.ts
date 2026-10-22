// Test-only broken fixtures, one independently recorded semantic defect per CT.
import type { ObjectClient, ObjectFixtureFactory } from './kit.js';
import { createObjectReference } from './objects-reference.js';

export const OBJECT_MUTANTS: readonly {
  id: string; revision: string; target: string; kill: RegExp; factory: ObjectFixtureFactory;
}[] = [
  { id: 'M01', revision: 'l01b1-m01-v1', target: 'CT-01', kill: /CT-01: first accepted bytes remain unchanged/,
    factory: () => {
      const f = createObjectReference(), client = f.client;
      f.client = (scope) => {
        const original = client(scope);
        return { ...original, async create(ref, bytes) {
          if (f.inspect(ref).length) f.fault(ref, 'delete');
          return original.create(ref, bytes);
        } };
      };
      f.clients = [f.client('workspace-a'), f.client('workspace-a')];
      return f;
    } },
  { id: 'M02', revision: 'l01b1-m02-v1', target: 'CT-02', kill: /CT-02: ordered-unit permutation changes digest/,
    factory: () => {
      const f = createObjectReference(), encode = f.encode;
      f.encode = (body) => encode({ ...body, units: [...body.units].sort((a, b) => a.unitId.localeCompare(b.unitId)) });
      return f;
    } },
  { id: 'M03', revision: 'l01b1-m03-v1', target: 'CT-03', kill: /CT-03: corrupt payload cannot be verified/,
    factory: () => {
      const f = createObjectReference(), client = f.client;
      f.client = (scope): ObjectClient => ({ ...client(scope), read: async (ref) => f.inspect(ref) });
      f.clients = [f.client('workspace-a'), f.client('workspace-a')];
      return f;
    } },
];
