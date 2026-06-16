import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export interface AnalysisSurfaceRepo {
    readonly path: string;
    readonly branch?: string;
    readonly window?: string;
}

export interface AnalysisSurfaceManifest {
    readonly id: string;
    readonly repos: readonly AnalysisSurfaceRepo[];
    readonly options?: Readonly<Record<string, unknown>>;
}

export interface ManifestParseDeps {
    readonly baseDir?: string;
    readonly exists?: (path: string) => boolean;
}

export class ManifestValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ManifestValidationError';
    }
}

interface YamlLine {
    readonly number: number;
    readonly indent: number;
    readonly text: string;
}

const ROOT_KEYS = new Set(['id', 'repos', 'options']);
const REPO_KEYS = new Set(['path', 'branch', 'window']);

export function parseAnalysisSurfaceManifest(
    source: string,
    deps: ManifestParseDeps = {},
): AnalysisSurfaceManifest {
    const raw = parseManifestText(source);
    return validateManifest(raw, deps);
}

function parseManifestText(source: string): unknown {
    const trimmed = source.trim();
    if (trimmed === '') {
        throw new ManifestValidationError('AnalysisSurface manifest is empty.');
    }
    if (trimmed.startsWith('{')) {
        try {
            return JSON.parse(trimmed) as unknown;
        } catch (err) {
            throw new ManifestValidationError(`Invalid AnalysisSurface JSON: ${messageOf(err)}`);
        }
    }
    return parseYamlManifest(source);
}

function validateManifest(raw: unknown, deps: ManifestParseDeps): AnalysisSurfaceManifest {
    if (!isRecord(raw)) {
        throw new ManifestValidationError('AnalysisSurface manifest must be an object.');
    }
    for (const key of Object.keys(raw)) {
        if (!ROOT_KEYS.has(key)) {
            throw new ManifestValidationError(`Unknown AnalysisSurface manifest key: ${key}`);
        }
    }

    const id = raw['id'];
    if (typeof id !== 'string' || id.trim() === '') {
        throw new ManifestValidationError('AnalysisSurface manifest requires a non-empty id.');
    }
    validateSurfaceId(id);

    const reposRaw = raw['repos'];
    if (!Array.isArray(reposRaw) || reposRaw.length === 0) {
        throw new ManifestValidationError('repos must contain at least one repository.');
    }

    const exists = deps.exists ?? existsSync;
    const baseDir = deps.baseDir ?? process.cwd();
    const repos = reposRaw.map((repoRaw, index) =>
        validateRepo(repoRaw, index, baseDir, exists),
    );

    const optionsRaw = raw['options'];
    let options: Readonly<Record<string, unknown>> | undefined;
    if (optionsRaw !== undefined) {
        if (!isRecord(optionsRaw)) {
            throw new ManifestValidationError('options must be an object when provided.');
        }
        options = optionsRaw;
    }

    return options === undefined ? { id, repos } : { id, repos, options };
}

function validateSurfaceId(id: string): void {
    if (
        id.includes('..') ||
        id.includes('/') ||
        id.includes('\\') ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)
    ) {
        throw new ManifestValidationError(
            'surface id must be a safe slug for a directory name (letters, digits, dot, underscore, hyphen; no .., /, or \\).',
        );
    }
}

function validateRepo(
    raw: unknown,
    index: number,
    baseDir: string,
    exists: (path: string) => boolean,
): AnalysisSurfaceRepo {
    if (!isRecord(raw)) {
        throw new ManifestValidationError(`repos[${index}] must be an object.`);
    }
    for (const key of Object.keys(raw)) {
        if (!REPO_KEYS.has(key)) {
            throw new ManifestValidationError(`Unknown repos[${index}] key: ${key}`);
        }
    }

    const path = raw['path'];
    if (typeof path !== 'string' || path.trim() === '') {
        throw new ManifestValidationError(`repos[${index}].path must be a non-empty string.`);
    }
    const repoPath = isAbsolute(path) ? path : resolve(baseDir, path);
    if (!exists(repoPath)) {
        throw new ManifestValidationError(`repo path does not exist: ${repoPath}`);
    }

    const repo: { path: string; branch?: string; window?: string } = { path: repoPath };
    const branch = raw['branch'];
    if (branch !== undefined) {
        if (typeof branch !== 'string' || branch.trim() === '') {
            throw new ManifestValidationError(`repos[${index}].branch must be a non-empty string.`);
        }
        repo.branch = branch;
    }
    const window = raw['window'];
    if (window !== undefined) {
        if (typeof window !== 'string' || window.trim() === '') {
            throw new ManifestValidationError(`repos[${index}].window must be a non-empty string.`);
        }
        repo.window = window;
    }
    return repo;
}

function parseYamlManifest(source: string): Record<string, unknown> {
    const lines = yamlLines(source);
    const root: Record<string, unknown> = {};
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];
        if (line.indent !== 0) {
            throw yamlError(line, 'top-level keys must not be indented');
        }
        const { key, value } = splitKeyValue(line);
        if (!ROOT_KEYS.has(key)) {
            throw yamlError(line, `unknown top-level key: ${key}`);
        }
        if (Object.prototype.hasOwnProperty.call(root, key)) {
            throw yamlError(line, `duplicate top-level key: ${key}`);
        }

        if (key === 'repos') {
            if (value !== '') {
                throw yamlError(line, 'repos must be a block list');
            }
            const parsed = parseYamlRepos(lines, index + 1);
            root[key] = parsed.repos;
            index = parsed.next;
            continue;
        }

        if (key === 'options') {
            if (value !== '') {
                root[key] = parseYamlScalar(value, line);
                index += 1;
                continue;
            }
            const parsed = parseYamlOptions(lines, index + 1);
            root[key] = parsed.options;
            index = parsed.next;
            continue;
        }

        root[key] = parseYamlScalar(value, line);
        index += 1;
    }

    return root;
}

function yamlLines(source: string): YamlLine[] {
    const lines: YamlLine[] = [];
    const rawLines = source.replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < rawLines.length; i += 1) {
        const raw = rawLines[i].replace(/\s+$/, '');
        if (raw.trim() === '' || raw.trimStart().startsWith('#')) {
            continue;
        }
        if (raw.includes('\t')) {
            throw new ManifestValidationError(`Invalid YAML on line ${i + 1}: tabs are not supported.`);
        }
        const indent = raw.length - raw.trimStart().length;
        lines.push({ number: i + 1, indent, text: raw.slice(indent) });
    }
    return lines;
}

function parseYamlRepos(
    lines: readonly YamlLine[],
    start: number,
): { repos: Record<string, unknown>[]; next: number } {
    const repos: Record<string, unknown>[] = [];
    let index = start;

    while (index < lines.length && lines[index].indent > 0) {
        const line = lines[index];
        if (line.indent !== 2 || !(line.text === '-' || line.text.startsWith('- '))) {
            throw yamlError(line, 'repos entries must be list items indented by two spaces');
        }

        const repo: Record<string, unknown> = {};
        const inline = line.text === '-' ? '' : line.text.slice(2).trim();
        if (inline !== '') {
            assignYamlField(repo, inline, line, REPO_KEYS);
        }
        index += 1;

        while (index < lines.length && lines[index].indent > 2) {
            const child = lines[index];
            if (child.indent !== 4) {
                throw yamlError(child, 'repo fields must be indented by four spaces');
            }
            assignYamlField(repo, child.text, child, REPO_KEYS);
            index += 1;
        }

        repos.push(repo);
    }

    return { repos, next: index };
}

function parseYamlOptions(
    lines: readonly YamlLine[],
    start: number,
): { options: Record<string, unknown>; next: number } {
    const options: Record<string, unknown> = {};
    let index = start;

    while (index < lines.length && lines[index].indent > 0) {
        const line = lines[index];
        if (line.indent !== 2) {
            throw yamlError(line, 'options fields must be indented by two spaces');
        }
        assignYamlField(options, line.text, line);
        index += 1;
    }

    return { options, next: index };
}

function assignYamlField(
    target: Record<string, unknown>,
    text: string,
    line: YamlLine,
    allowedKeys?: ReadonlySet<string>,
): void {
    const { key, value } = splitKeyValue({ ...line, text });
    if (allowedKeys !== undefined && !allowedKeys.has(key)) {
        throw yamlError(line, `unknown key: ${key}`);
    }
    if (Object.prototype.hasOwnProperty.call(target, key)) {
        throw yamlError(line, `duplicate key: ${key}`);
    }
    target[key] = parseYamlScalar(value, line);
}

function splitKeyValue(line: YamlLine): { key: string; value: string } {
    const colon = line.text.indexOf(':');
    if (colon <= 0) {
        throw yamlError(line, 'expected key: value');
    }
    const key = line.text.slice(0, colon).trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) {
        throw yamlError(line, `invalid key: ${key}`);
    }
    return { key, value: line.text.slice(colon + 1).trim() };
}

function parseYamlScalar(value: string, line: YamlLine): unknown {
    if (value.startsWith('"') || value.startsWith("'")) {
        return parseQuotedYamlString(value, line);
    }
    if (value.startsWith('{') || value.startsWith('[')) {
        try {
            return JSON.parse(value) as unknown;
        } catch (err) {
            throw yamlError(line, `invalid inline JSON value: ${messageOf(err)}`);
        }
    }
    if (value === 'true') {
        return true;
    }
    if (value === 'false') {
        return false;
    }
    if (value === 'null') {
        return null;
    }
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
        return Number(value);
    }
    return value;
}

function parseQuotedYamlString(value: string, line: YamlLine): string {
    if (value.startsWith('"')) {
        if (!value.endsWith('"')) {
            throw yamlError(line, 'unterminated double-quoted string');
        }
        try {
            return JSON.parse(value) as string;
        } catch (err) {
            throw yamlError(line, `invalid double-quoted string: ${messageOf(err)}`);
        }
    }
    if (!value.endsWith("'")) {
        throw yamlError(line, 'unterminated single-quoted string');
    }
    return value.slice(1, -1).replace(/''/g, "'");
}

function yamlError(line: YamlLine, message: string): ManifestValidationError {
    return new ManifestValidationError(`Invalid AnalysisSurface YAML on line ${line.number}: ${message}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
