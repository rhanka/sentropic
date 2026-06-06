/**
 * Bare-verb alias layer for the `stp` umbrella CLI (BR-42i).
 *
 * A {@link VerbBinding} maps a bare verb (e.g. `report`) to an ownerCli + ownerArgv tuple
 * so `stp report` can dispatch to `stp track report` without requiring the caller to know
 * the owning subcommand name. This layer sits on top of {@link SubcommandRegistry}: the
 * dispatcher resolves ownerCli via the existing SubcommandRegistry, so no new authority
 * boundary is created.
 */

/** A single bare-verb-to-subcommand binding (e.g. `report` → `track report`). */
export interface VerbBinding {
    /** The bare verb token invoked directly after `stp` (e.g. `report`). Non-empty. */
    readonly verb: string;
    /**
     * The owning subcommand name as registered in {@link SubcommandRegistry}
     * (e.g. `track`). Non-empty.
     */
    readonly ownerCli: string;
    /**
     * The argv to prepend when calling `ownerSubcommand.run(...)`. The dispatcher calls
     * `ownerSubcommand.run([...ownerArgv, ...rest])` where `rest` is everything after the
     * bare verb in the original `stp <verb> [rest...]` invocation.
     * (e.g. `['report']` so `stp report --csv` → `track.run(['report', '--csv'])`).
     */
    readonly ownerArgv: readonly string[];
    /** Optional human-readable note surfaced in help/debug (e.g. `'equiv: stp track report'`). */
    readonly note?: string;
}

/** Thrown when two bindings claim the same {@link VerbBinding.verb}. */
export class DuplicateVerbError extends Error {
    constructor(public readonly verb: string) {
        super(`Verb "${verb}" is already registered.`);
        this.name = 'DuplicateVerbError';
    }
}

/**
 * Registry of bare-verb aliases. Construct one per process (the bin owns it).
 * Parallel in design to {@link SubcommandRegistry} but holds verb→subcommand mappings.
 */
export class VerbRegistry {
    private readonly byVerb = new Map<string, VerbBinding>();

    /**
     * Register a verb binding. Rejects bindings with empty verb or ownerCli, and throws
     * on duplicate verb so wiring mistakes fail loudly at startup.
     */
    register(binding: VerbBinding): this {
        const { verb, ownerCli } = binding;
        if (typeof verb !== 'string' || verb.trim() === '') {
            throw new TypeError(`VerbBinding.verb must be a non-empty string (got ${JSON.stringify(verb)}).`);
        }
        if (typeof ownerCli !== 'string' || ownerCli.trim() === '') {
            throw new TypeError(
                `VerbBinding.ownerCli must be a non-empty string (got ${JSON.stringify(ownerCli)}).`,
            );
        }
        if (this.byVerb.has(verb)) {
            throw new DuplicateVerbError(verb);
        }
        this.byVerb.set(verb, binding);
        return this;
    }

    /** Look up a binding by its bare verb token, or `undefined` if not registered. */
    get(verb: string): VerbBinding | undefined {
        return this.byVerb.get(verb);
    }

    /** Registered bindings, sorted by verb for deterministic output. */
    list(): readonly VerbBinding[] {
        return [...this.byVerb.values()].sort((a, b) => a.verb.localeCompare(b.verb));
    }
}
