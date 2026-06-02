/**
 * `stp app init <name>` orchestration (SPEC §2.2, §2.4).
 *
 * Pipeline: validate → resolve plan → (dry-run stops here) → write → git init + commit →
 * GitHub create+push → h2a descriptor → print next steps.
 *
 * Every side-effecting dependency is INJECTED (the scaffold manifest, the process runner,
 * the existing-dir/empty-dir/remote probes, and the writer) so the orchestration is fully
 * unit-testable and hermetic. The default wiring uses Node built-ins + the real process
 * runner. The real `templates/chat-app/**` manifest is supplied by a later lot; here the
 * manifest is a required input.
 */

import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { ScaffoldManifest, TokenMap } from '../templating/types.js';
import { resolvePlan } from '../generator/plan.js';
import { writePlan } from '../generator/writer.js';
import type { ScaffoldPlan } from '../generator/types.js';
import { nodeProcessRunner, renderCommand, type ProcessCommand, type ProcessRunner } from './process.js';
import type { InitOptions } from './options.js';
import { LLM_MESH_PROVIDERS } from './options.js';
import { validateAppName, validateTargetDir } from './validate.js';

/** Error thrown when a non-empty target dir is hit without `--force`. */
export class TargetNotEmptyError extends Error {
    readonly dir: string;
    readonly entries: readonly string[];
    constructor(dir: string, entries: readonly string[]) {
        super(
            `Target directory "${dir}" is not empty. Refusing to scaffold. ` +
                `Existing entries: ${entries.join(', ')}. Pass --force to overwrite scaffold-owned files.`,
        );
        this.name = 'TargetNotEmptyError';
        this.dir = dir;
        this.entries = entries;
    }
}

/** Error thrown when the target dir already has a git remote (never mutate it — BR42a-G). */
export class ExistingRemoteError extends Error {
    readonly dir: string;
    constructor(dir: string) {
        super(`Target directory "${dir}" already has a git remote. Refusing to mutate it (BR42a-G).`);
        this.name = 'ExistingRemoteError';
        this.dir = dir;
    }
}

/** Error thrown when the GitHub repo `<owner>/<name>` already exists (refuse — BR42a-G). */
export class RepoCollisionError extends Error {
    readonly slug: string;
    constructor(slug: string) {
        super(`GitHub repository "${slug}" already exists. Refusing to create (BR42a-G).`);
        this.name = 'RepoCollisionError';
        this.slug = slug;
    }
}

/** Token map a template manifest may reference. Always fully populated (no missing tokens). */
export interface InitTokens extends TokenMap {
    readonly name: string;
    readonly slug: string;
    readonly provider: string;
    readonly api_port: string;
    readonly ui_port: string;
    readonly maildev_port: string;
    /** Repo URL, backfilled before first commit when `--github`; empty placeholder otherwise. */
    readonly repo_url: string;
    /** Deterministic offline reply baked into the generated backend's in-memory adapter. */
    readonly assistant_reply: string;
}

/** Injectable dependencies for an `init` run. */
export interface InitDeps {
    /** The scaffold manifest to materialise (the real chat-app subtree lands next lot). */
    readonly manifest: ScaffoldManifest;
    /** Process runner for git/gh shell-outs (default: real spawn). */
    readonly runner?: ProcessRunner;
    /** Sink for human-facing output (default: console.log). */
    readonly log?: (line: string) => void;
    /** Default generated-app ports baked into tokens. */
    readonly ports?: { api: number; ui: number; maildev: number };
}

/** Result of a (possibly dry) init run. */
export interface InitResult {
    /** Absolute resolved target directory. */
    readonly targetDir: string;
    /** The resolved deterministic plan. */
    readonly plan: ScaffoldPlan;
    /** Absolute paths written (empty on dry-run). */
    readonly written: readonly string[];
    /** Whether this was a dry-run (nothing written, no repo created). */
    readonly dryRun: boolean;
    /** The exact `gh repo create ...` command string (when `--github`), else undefined. */
    readonly ghCommand?: string;
}

/** Default ports for the generated app (this branch slot; never the monorepo 8787/5173/1080). */
const DEFAULT_PORTS = { api: 9211, ui: 5411, maildev: 1311 };

/** Build the fully-populated token map from validated options. */
export function buildTokens(options: InitOptions, ports: { api: number; ui: number; maildev: number }): InitTokens {
    return {
        name: options.name,
        slug: options.name,
        provider: options.provider,
        api_port: String(ports.api),
        ui_port: String(ports.ui),
        maildev_port: String(ports.maildev),
        repo_url: '',
        assistant_reply: `Hello from ${options.name}! This is a deterministic offline reply from @sentropic/chat-server.`,
    };
}

/** True when `dir` does not exist or exists and is empty. */
async function dirIsEmpty(dir: string): Promise<boolean> {
    if (!existsSync(dir)) {
        return true;
    }
    const entries = await readdir(dir);
    return entries.length === 0;
}

/** List the existing entries of a dir (for the refuse-with-list message). */
async function listDir(dir: string): Promise<string[]> {
    if (!existsSync(dir)) {
        return [];
    }
    return (await readdir(dir)).sort();
}

/** Build the exact `gh repo create` command (BR42a-G). */
function ghCreateCommand(options: InitOptions, targetDir: string): ProcessCommand {
    const slug = `${options.githubOwner}/${options.name}`;
    return {
        file: 'gh',
        args: [
            'repo',
            'create',
            slug,
            `--${options.githubVisibility}`,
            '--source',
            targetDir,
            '--push',
        ],
    };
}

/** Build the local h2a descriptor (minimal, explicitly non-protocol — BR42a-F). */
function h2aDescriptor(options: InitOptions, repoUrl: string): string {
    // Deterministic JSON: stable key order, no timestamps/random (R10).
    const descriptor = {
        $schema: 'sentropic-build-cli/h2a-local-descriptor',
        kind: 'h2a-local-descriptor',
        protocol: false,
        app: options.name,
        repoUrl,
        intendedScope: 'unset',
        intendedRole: 'unset',
        note: 'Local non-protocol placeholder. Real h2a register is deferred (BR42a-F, EVO-9).',
    };
    return `${JSON.stringify(descriptor, null, 2)}\n`;
}

/**
 * Run `stp app init`.
 *
 * @throws {InvalidAppNameError | InvalidTargetDirError | InvalidOptionError} on bad input.
 * @throws {TargetNotEmptyError} when the dir is non-empty and `--force` is absent.
 * @throws {ExistingRemoteError} when `--github` and the dir already has a remote.
 * @throws {RepoCollisionError} when `--github` and `<owner>/<name>` already exists.
 */
export async function runInit(options: InitOptions, deps: InitDeps): Promise<InitResult> {
    const runner = deps.runner ?? nodeProcessRunner;
    const log = deps.log ?? ((line: string) => console.log(line));
    const ports = deps.ports ?? DEFAULT_PORTS;

    // 1. Validate (slug rules + traversal rejection on name and --dir).
    validateAppName(options.name);
    validateTargetDir(options.dir);

    const targetDir = isAbsolute(options.dir) ? resolve(options.dir) : resolve(process.cwd(), options.dir);

    // Provider sanity (stub is template-owned, not an llm-mesh id).
    if (options.provider !== 'stub' && !LLM_MESH_PROVIDERS.includes(options.provider)) {
        // parseInitOptions already guards this; defensive re-check keeps runInit safe when
        // called with a hand-built options object.
        throw new Error(`Unknown provider "${options.provider}"`);
    }

    // 2. Resolve the deterministic plan from the manifest + tokens.
    let tokens = buildTokens(options, ports);
    let plan = resolvePlan(deps.manifest, { tokens });

    const ghCommandObj = options.github ? ghCreateCommand(options, targetDir) : undefined;
    const ghCommand = ghCommandObj ? renderCommand(ghCommandObj) : undefined;

    // 3. Dry-run stops here: print the full plan + the exact gh command; write NOTHING.
    if (options.dryRun) {
        log(`Plan for "${options.name}" → ${targetDir} (provider: ${options.provider})`);
        for (const file of plan.files) {
            log(`  + ${file.outputPath}`);
        }
        if (ghCommand) {
            log(`GitHub (would run, not executed): ${ghCommand}`);
        }
        if (options.h2aRegister) {
            log('h2a: would write local descriptor .sentropic/h2a-local.json (not executed)');
        }
        log('dry-run: no files written, no repo created.');
        return { targetDir, plan, written: [], dryRun: true, ghCommand };
    }

    // 4. GitHub pre-flight FIRST: never mutate an existing remote; refuse on collision
    //    (BR42a-G). These irreversible-side-effect gates run before the empty-dir guard so
    //    a dir that exists only to carry a remote is refused with the correct, specific
    //    error (ExistingRemoteError), not a generic not-empty error.
    if (options.github) {
        await assertNoExistingRemote(runner, targetDir, options.git);
        await assertRepoDoesNotExist(runner, options);

        // Backfill the repo URL token BEFORE the first commit (clean history — BR42a-G).
        const repoUrl = `https://github.com/${options.githubOwner}/${options.name}`;
        tokens = { ...tokens, repo_url: repoUrl };
        plan = resolvePlan(deps.manifest, { tokens });
    }

    // Empty-dir guard (refuse-with-list unless --force).
    const empty = await dirIsEmpty(targetDir);
    if (!empty && !options.force) {
        throw new TargetNotEmptyError(targetDir, await listDir(targetDir));
    }

    // 5. Materialise the scaffold (scaffold-owned overwrite only under --force).
    const written = await writePlan(plan, { targetDir, overwrite: options.force });
    log(`Scaffolded "${options.name}" into ${targetDir} (${written.length} files).`);

    // 6. h2a descriptor (minimal local, non-protocol — BR42a-F). No network call.
    if (options.h2aRegister) {
        const repoUrl = options.github ? `https://github.com/${options.githubOwner}/${options.name}` : '';
        await writeH2aDescriptor(targetDir, h2aDescriptor(options, repoUrl), options.force);
        log('h2a: wrote local non-protocol descriptor .sentropic/h2a-local.json');
    }

    // 7. git init + first commit.
    if (options.git) {
        await gitInitAndCommit(runner, targetDir, options.name);
        log('git: initialised repo + first commit.');
    }

    // 8. GitHub repo create + push.
    if (options.github && ghCommandObj) {
        const created = await runner.run({ ...ghCommandObj, cwd: targetDir });
        if (created.code !== 0) {
            throw new Error(`gh repo create failed (${created.code}): ${created.stderr.trim()}`);
        }
        log(`github: created ${options.githubOwner}/${options.name} and pushed.`);
    }

    // 9. Next steps.
    printNextSteps(log, options, targetDir, ports);

    return { targetDir, plan, written, dryRun: false, ghCommand };
}

/** Refuse if the target dir already has a git remote (BR42a-G). */
async function assertNoExistingRemote(runner: ProcessRunner, targetDir: string, _gitInit: boolean): Promise<void> {
    if (!existsSync(join(targetDir, '.git'))) {
        return;
    }
    const result = await runner.run({ file: 'git', args: ['remote'], cwd: targetDir });
    if (result.code === 0 && result.stdout.trim().length > 0) {
        throw new ExistingRemoteError(targetDir);
    }
}

/** Refuse if `<owner>/<name>` already exists on GitHub (BR42a-G). */
async function assertRepoDoesNotExist(runner: ProcessRunner, options: InitOptions): Promise<void> {
    const slug = `${options.githubOwner}/${options.name}`;
    const result = await runner.run({ file: 'gh', args: ['repo', 'view', slug] });
    if (result.code === 0) {
        throw new RepoCollisionError(slug);
    }
}

/** `git init` + `git add -A` + first commit (conventional message). */
async function gitInitAndCommit(runner: ProcessRunner, targetDir: string, name: string): Promise<void> {
    const steps: ProcessCommand[] = [
        { file: 'git', args: ['init', '-q'], cwd: targetDir },
        { file: 'git', args: ['add', '-A'], cwd: targetDir },
        {
            file: 'git',
            args: ['commit', '-q', '-m', `chore: scaffold ${name} via @sentropic/build-cli`],
            cwd: targetDir,
        },
    ];
    for (const step of steps) {
        const result = await runner.run(step);
        if (result.code !== 0) {
            throw new Error(`git step failed (${step.args.join(' ')}): ${result.stderr.trim()}`);
        }
    }
}

/** Write the h2a descriptor under `.sentropic/`. */
async function writeH2aDescriptor(targetDir: string, content: string, overwrite: boolean): Promise<void> {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const dir = join(targetDir, '.sentropic');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'h2a-local.json');
    if (existsSync(file) && !overwrite) {
        return;
    }
    await writeFile(file, content);
}

/** Print the next-steps block. */
function printNextSteps(
    log: (line: string) => void,
    options: InitOptions,
    targetDir: string,
    ports: { api: number; ui: number; maildev: number },
): void {
    log('Next steps:');
    log(`  cd ${targetDir}`);
    log('  make dev');
    log(`  UI:  http://localhost:${ports.ui}`);
    log(`  API: http://localhost:${ports.api}`);
}
