/**
 * Subcommand registration seam for the `@sentropic/cli` umbrella (BR42a1-Q1, option 3:
 * a typed `registerSubcommand()` contract co-designed with `@sentropic/build-cli` as the
 * first real consumer).
 *
 * The umbrella CLI core (this file + `cli.ts`) intentionally does NOT import any concrete
 * subcommand package. Subcommands are wired by the composition root (the `stp` bin) which
 * imports `@sentropic/build-cli` and calls {@link registerSubcommand}. This keeps the core
 * free of a hard dependency on its plugins (no cycle: `build-cli` never imports `cli`) and
 * leaves room for a later package-name-convention resolver (`@sentropic/*-cli`) to sit on
 * top of this same typed contract.
 */

/** A single federated subcommand (e.g. `stp app …`). */
export interface Subcommand {
    /** Invocation token after `stp` (e.g. `app`). Must be a non-empty, space-free slug. */
    readonly name: string;
    /** One-line summary rendered by `stp --help`. */
    readonly summary: string;
    /** Version string surfaced by `stp --version` (e.g. the plugin package version). */
    readonly version: string;
    /**
     * Run the subcommand with the argv that follows its name (so `stp app init x` calls
     * `run(['init', 'x'])`). Resolves to a process exit code (`0` = success).
     */
    run(argv: readonly string[]): Promise<number>;
}

/** Thrown when two subcommands claim the same {@link Subcommand.name}. */
export class DuplicateSubcommandError extends Error {
    constructor(public readonly name: string) {
        super(`Subcommand "${name}" is already registered.`);
        this.name = 'DuplicateSubcommandError';
    }
}

/** Thrown when a {@link Subcommand} is malformed at registration time. */
export class InvalidSubcommandError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidSubcommandError';
    }
}

/** A typed registry the dispatcher reads. Construct one per process (the bin owns it). */
export class SubcommandRegistry {
    private readonly byName = new Map<string, Subcommand>();

    /**
     * Register a subcommand. Rejects malformed entries and duplicate names so wiring
     * mistakes fail loudly at startup rather than producing a silently shadowed command.
     */
    register(subcommand: Subcommand): this {
        const { name, summary, version, run } = subcommand;
        if (typeof name !== 'string' || name.trim() === '' || /\s/.test(name)) {
            throw new InvalidSubcommandError(
                `Subcommand name must be a non-empty, space-free string (got ${JSON.stringify(name)}).`,
            );
        }
        if (typeof summary !== 'string' || summary.trim() === '') {
            throw new InvalidSubcommandError(`Subcommand "${name}" requires a non-empty summary.`);
        }
        if (typeof version !== 'string' || version.trim() === '') {
            throw new InvalidSubcommandError(`Subcommand "${name}" requires a non-empty version.`);
        }
        if (typeof run !== 'function') {
            throw new InvalidSubcommandError(`Subcommand "${name}" requires a run() function.`);
        }
        if (this.byName.has(name)) {
            throw new DuplicateSubcommandError(name);
        }
        this.byName.set(name, subcommand);
        return this;
    }

    /** Look up a subcommand by its invocation name, or `undefined` if not registered. */
    get(name: string): Subcommand | undefined {
        return this.byName.get(name);
    }

    /** Whether a subcommand with this name is registered. */
    has(name: string): boolean {
        return this.byName.has(name);
    }

    /** Registered subcommands, sorted by name for deterministic help/version output. */
    list(): readonly Subcommand[] {
        return [...this.byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
}
