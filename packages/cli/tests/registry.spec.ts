import { describe, expect, it } from 'vitest';
import {
    SubcommandRegistry,
    DuplicateSubcommandError,
    InvalidSubcommandError,
    type Subcommand,
} from '../src/registry.js';

function stubSubcommand(overrides: Partial<Subcommand> = {}): Subcommand {
    return {
        name: 'app',
        summary: 'Scaffold a chat app.',
        version: '0.2.0',
        run: async () => 0,
        ...overrides,
    };
}

describe('SubcommandRegistry', () => {
    it('registers and looks up a subcommand by name', () => {
        const registry = new SubcommandRegistry();
        const app = stubSubcommand();
        registry.register(app);

        expect(registry.has('app')).toBe(true);
        expect(registry.get('app')).toBe(app);
        expect(registry.get('missing')).toBeUndefined();
        expect(registry.list().map((s) => s.name)).toEqual(['app']);
    });

    it('rejects a duplicate name', () => {
        const registry = new SubcommandRegistry();
        registry.register(stubSubcommand());
        expect(() => registry.register(stubSubcommand({ summary: 'other' }))).toThrow(
            DuplicateSubcommandError,
        );
    });

    it('rejects malformed subcommands', () => {
        const registry = new SubcommandRegistry();
        expect(() => registry.register(stubSubcommand({ name: '' }))).toThrow(InvalidSubcommandError);
        expect(() => registry.register(stubSubcommand({ name: 'two words' }))).toThrow(
            InvalidSubcommandError,
        );
        expect(() => registry.register(stubSubcommand({ summary: '' }))).toThrow(InvalidSubcommandError);
        expect(() => registry.register(stubSubcommand({ version: '' }))).toThrow(InvalidSubcommandError);
        expect(() =>
            registry.register(stubSubcommand({ run: undefined as unknown as Subcommand['run'] })),
        ).toThrow(InvalidSubcommandError);
    });

    it('lists subcommands sorted by name for deterministic output', () => {
        const registry = new SubcommandRegistry();
        registry.register(stubSubcommand({ name: 'remote' }));
        registry.register(stubSubcommand({ name: 'app' }));
        registry.register(stubSubcommand({ name: 'graphify' }));
        expect(registry.list().map((s) => s.name)).toEqual(['app', 'graphify', 'remote']);
    });
});
