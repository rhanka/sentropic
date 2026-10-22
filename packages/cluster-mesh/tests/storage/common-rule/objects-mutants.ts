// Test-only broken fixtures, each with a designated semantic assertion.
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
        return { ...original, preparer: { async create(ref, bytes) {
          if (f.inspect(ref).length) f.fault(ref, 'delete');
          return original.preparer.create(ref, bytes);
        } } };
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
      f.client = (scope): ObjectClient => ({ ...client(scope), reader: { read: async (ref) => f.inspect(ref) } });
      f.clients = [f.client('workspace-a'), f.client('workspace-a')];
      return f;
    } },
  { id: 'M01-invalid-retry', revision: 'l01b1-m01-invalid-retry-v1', target: 'CT-01',
    kill: /CT-01: invalid digest retry preserves accepted bytes/,
    factory: () => {
      const f = createObjectReference(), client = f.client;
      f.client = (scope) => {
        const original = client(scope);
        return { ...original, preparer: { async create(ref, bytes) {
          try { return await original.preparer.create(ref, bytes); }
          catch (error) {
            if (error instanceof Error && error.message === 'corrupt' && f.inspect(ref).length) f.fault(ref, 'delete');
            throw error;
          }
        } } };
      };
      f.clients = [f.client('workspace-a'), f.client('workspace-a')];
      return f;
    } },
  { id: 'M02-ignore-digest', revision: 'l01b1-m02-ignore-digest-v1', target: 'CT-02',
    kill: /CT-02: supplied manifest digest must match/,
    factory: () => {
      const f = createObjectReference(), verify = f.verify;
      f.verify = async (body, digest, budget) => verify(body, digest === '' ? '' : f.encode(body).sha256, budget);
      return f;
    } },
];
