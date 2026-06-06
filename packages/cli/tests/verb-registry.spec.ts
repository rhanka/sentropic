import { describe, expect, it } from 'vitest';
import { VerbRegistry, DuplicateVerbError, type VerbBinding } from '../src/verb-registry.js';

function stubBinding(overrides: Partial<VerbBinding> = {}): VerbBinding {
    return {
        verb: 'report',
        ownerCli: 'track',
        ownerArgv: ['report'],
        ...overrides,
    };
}

describe('VerbRegistry', () => {
    it('registers and retrieves a binding by verb', () => {
        const registry = new VerbRegistry();
        const binding = stubBinding();
        registry.register(binding);

        expect(registry.get('report')).toBe(binding);
        expect(registry.get('missing')).toBeUndefined();
    });

    it('throws DuplicateVerbError when registering the same verb twice', () => {
        const registry = new VerbRegistry();
        registry.register(stubBinding());
        expect(() => registry.register(stubBinding({ note: 'second attempt' }))).toThrow(
            DuplicateVerbError,
        );
    });

    it('DuplicateVerbError carries the duplicate verb name', () => {
        const registry = new VerbRegistry();
        registry.register(stubBinding());
        try {
            registry.register(stubBinding());
            expect.fail('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(DuplicateVerbError);
            expect((err as DuplicateVerbError).verb).toBe('report');
            expect((err as DuplicateVerbError).name).toBe('DuplicateVerbError');
        }
    });

    it('rejects a binding with empty verb', () => {
        const registry = new VerbRegistry();
        expect(() => registry.register(stubBinding({ verb: '' }))).toThrow(TypeError);
    });

    it('rejects a binding with empty ownerCli', () => {
        const registry = new VerbRegistry();
        expect(() => registry.register(stubBinding({ ownerCli: '' }))).toThrow(TypeError);
    });

    it('returns bindings sorted by verb from .list()', () => {
        const registry = new VerbRegistry();
        registry.register(stubBinding({ verb: 'status', ownerCli: 'track', ownerArgv: ['status'] }));
        registry.register(stubBinding({ verb: 'ingest', ownerCli: 'track', ownerArgv: ['ingest'] }));
        registry.register(stubBinding({ verb: 'report', ownerCli: 'track', ownerArgv: ['report'] }));

        const verbs = registry.list().map((b) => b.verb);
        expect(verbs).toEqual(['ingest', 'report', 'status']);
    });

    it('.list() output is stable across calls', () => {
        const registry = new VerbRegistry();
        registry.register(stubBinding({ verb: 'z-last', ownerCli: 'track', ownerArgv: [] }));
        registry.register(stubBinding({ verb: 'a-first', ownerCli: 'track', ownerArgv: [] }));

        expect(registry.list().map((b) => b.verb)).toEqual(registry.list().map((b) => b.verb));
    });

    it('.register() returns this for chaining', () => {
        const registry = new VerbRegistry();
        const returned = registry.register(stubBinding());
        expect(returned).toBe(registry);
    });

    it('stores the optional note field unchanged', () => {
        const registry = new VerbRegistry();
        registry.register(stubBinding({ note: 'equiv: stp track report' }));
        expect(registry.get('report')?.note).toBe('equiv: stp track report');
    });
});
