import type { ExtensionContext } from 'vscode';
import { execFile as execFileCb } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export type VsCodeLocalToolName =
  | 'bash'
  | 'ls'
  | 'rg'
  | 'file_read'
  | 'file_edit'
  | 'git_status'
  | 'git_diff';

export type VsCodeToolPermissionPolicy = 'allow' | 'deny';

export type VsCodeToolPermissionDecision =
  | 'allow_once'
  | 'deny_once'
  | 'allow_always'
  | 'deny_always';

export type VsCodeToolPermissionRequest = {
  requestId: string;
  toolName: string;
  origin: string;
  details?: Record<string, unknown>;
};

export type VsCodeToolPermissionEntry = {
  toolName: string;
  origin: string;
  policy: VsCodeToolPermissionPolicy;
  pathPattern?: string | null;
  updatedAt: string;
};

type PendingPermissionRequest = {
  requestId: string;
  toolCallId: string;
  toolName: string;
  origin: string;
  pathPattern?: string | null;
  details?: Record<string, unknown>;
};

type ExecuteInput = {
  toolCallId: string;
  name: string;
  args?: unknown;
};

type DecisionInput = {
  requestId: string;
  decision: string;
};

type PolicyInput = {
  toolName: string;
  origin: string;
  policy: string;
  pathPattern?: string;
};

type PolicyDeleteInput = {
  toolName: string;
  origin: string;
  pathPattern?: string;
};

type CommandDecision = 'allow' | 'ask' | 'deny';

type RuntimeDeps = {
  getWorkspaceRoot: () => string | null;
  getGlobalState: <T>(key: string, fallback: T) => T;
  updateGlobalState: (key: string, value: unknown) => Thenable<void>;
};

const STORAGE_KEY_POLICIES = 'topai.vscode.localToolPolicies.v1';
const ORIGIN_VSCODE_WORKSPACE = 'vscode://workspace';
const TOOL_NAME_REGEX = /^[a-z0-9:_*-]{1,96}$/i;
const MAX_OUTPUT_CHARS = 12_000;
const MAX_FILE_READ_CHARS = 64_000;
const MAX_RG_RESULTS = 400;
const MAX_LS_DEPTH = 4;
const MAX_RG_OFFSET = 2_000;
const MAX_RG_SCAN = 2_400;
const SENSITIVE_PATH_MATCHERS = [
  /(^|\/)\.env(?:\..+)?$/i,
  /(^|\/).*\.pem$/i,
  /(^|\/)id_rsa(?:\.pub)?$/i,
  /(^|\/)secrets?(?:\/|$)/i,
  /(^|\/)\.aws(?:\/|$)/i,
  /(^|\/)\.ssh(?:\/|$)/i,
];

const isToolName = (value: string): value is VsCodeLocalToolName => {
  return (
    value === 'bash' ||
    value === 'ls' ||
    value === 'rg' ||
    value === 'file_read' ||
    value === 'file_edit' ||
    value === 'git_status' ||
    value === 'git_diff'
  );
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const truncate = (value: string, max = MAX_OUTPUT_CHARS): string => {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…(truncated)…`;
};

const toolPatternToRegex = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\\\*/g, '.*')}$`, 'i');
};

const normalizeToolPattern = (raw: string): string | null => {
  const value = raw.trim().toLowerCase();
  if (!value || !TOOL_NAME_REGEX.test(value) || value.includes('**')) return null;
  return value;
};

const normalizeOrigin = (raw: string): string | null => {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value === '*') return '*';
  if (value === ORIGIN_VSCODE_WORKSPACE) return ORIGIN_VSCODE_WORKSPACE;
  return null;
};

const normalizePathPattern = (raw: string | null | undefined): string | null => {
  const value = String(raw ?? '')
    .trim()
    .replace(/\\/g, '/');
  if (!value) return null;
  if (value.startsWith('/')) return null;
  if (value.includes('..')) return null;
  if (value.includes('//')) return null;
  return value.toLowerCase();
};

const pathPatternToRegex = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\\\*/g, '.*')}$`, 'i');
};

const matchesPathPattern = (
  pattern: string | null | undefined,
  targetPath: string | null,
): boolean => {
  if (!pattern) return true;
  if (!targetPath) return false;
  return pathPatternToRegex(pattern).test(targetPath);
};

const getPathPatternSpecificity = (pattern: string | null | undefined): number => {
  if (!pattern) return 0;
  return pattern.replace(/\*/g, '').length;
};

const isSensitivePath = (relativePath: string | null): boolean => {
  if (!relativePath) return false;
  const normalized = relativePath.replace(/\\/g, '/');
  return SENSITIVE_PATH_MATCHERS.some((matcher) => matcher.test(normalized));
};

const isMissingBinaryError = (error: unknown, binary: string): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('ENOENT') && message.toLowerCase().includes(binary);
};

const extractPatchTargetPath = (patchText: string): string | null => {
  const lines = patchText.split(/\r?\n/g);
  const plusLine = lines.find((line) => line.startsWith('+++ '));
  if (!plusLine) return null;
  const raw = plusLine.slice(4).trim();
  if (!raw) return null;
  const sanitized = raw.startsWith('b/') ? raw.slice(2) : raw;
  return sanitized || null;
};

const applyUnifiedPatchFallback = async (
  workspaceRoot: string,
  patchText: string,
): Promise<{ applied: boolean; mode: 'apply_patch'; fallback: true }> => {
  const relativePath = extractPatchTargetPath(patchText);
  if (!relativePath) {
    throw new Error('file_edit(apply_patch): unsupported patch format');
  }
  const targetPath = await resolveRealPath(workspaceRoot, relativePath);
  let content = await fs.readFile(targetPath, 'utf8');

  const lines = patchText.split(/\r?\n/g);
  let index = 0;
  let appliedHunks = 0;
  while (index < lines.length) {
    if (!lines[index]?.startsWith('@@')) {
      index += 1;
      continue;
    }
    index += 1;
    const oldChunk: string[] = [];
    const nextChunk: string[] = [];
    while (
      index < lines.length &&
      !lines[index]?.startsWith('@@') &&
      !lines[index]?.startsWith('diff --git')
    ) {
      const line = lines[index] ?? '';
      if (line.startsWith('\\')) {
        index += 1;
        continue;
      }
      const marker = line[0] ?? '';
      const body = line.slice(1);
      if (marker === ' ' || marker === '-') oldChunk.push(body);
      if (marker === ' ' || marker === '+') nextChunk.push(body);
      index += 1;
    }
    const oldText = oldChunk.join('\n');
    const nextText = nextChunk.join('\n');
    if (!oldText) continue;
    if (!content.includes(oldText)) {
      throw new Error('file_edit(apply_patch): hunk context not found');
    }
    content = content.replace(oldText, nextText);
    appliedHunks += 1;
  }

  if (appliedHunks === 0) {
    throw new Error('file_edit(apply_patch): no hunks could be applied');
  }

  await fs.writeFile(targetPath, content, 'utf8');
  return {
    mode: 'apply_patch',
    applied: true,
    fallback: true,
  };
};

const matchesToolPattern = (pattern: string, toolName: string): boolean => {
  if (pattern === '*') return true;
  if (pattern === toolName) return true;
  if (!pattern.includes('*') && !pattern.includes(':')) {
    return toolName === pattern || toolName.startsWith(`${pattern}:`);
  }
  if (!pattern.includes('*')) return false;
  return toolPatternToRegex(pattern).test(toolName);
};

const getPatternSpecificity = (pattern: string): number => {
  if (pattern === '*') return 0;
  const literal = pattern.replace(/\*/g, '').length;
  if (!pattern.includes('*')) {
    return (pattern.includes(':') ? 2000 : 1500) + literal;
  }
  return 500 + literal;
};

const parseBashSegments = (command: string): string[] => {
  return command
    .split(/(?:&&|\|\||;|\||\$\(|\(|\))/g)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
};

const tokenize = (segment: string): string[] =>
  segment
    .trim()
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());

const resolveRealPath = async (workspaceRoot: string, inputPath?: string): Promise<string> => {
  const candidate = inputPath?.trim() || '.';
  const resolved = path.resolve(workspaceRoot, candidate);
  const rootResolved = path.resolve(workspaceRoot);
  if (!resolved.startsWith(rootResolved)) {
    throw new Error(`Path outside workspace is not allowed: ${candidate}`);
  }
  return resolved;
};

const defaultWorkspaceDecision = (
  toolName: VsCodeLocalToolName,
  args: Record<string, unknown>,
): CommandDecision => {
  if (toolName === 'file_edit') return 'ask';
  if (toolName === 'git_status') return 'allow';
  if (toolName === 'git_diff') return 'allow';
  if (toolName === 'ls' || toolName === 'rg' || toolName === 'file_read') return 'allow';

  if (toolName !== 'bash') return 'ask';

  const command = typeof args.command === 'string' ? args.command.trim() : '';
  if (!command) return 'deny';
  const segments = parseBashSegments(command);
  if (segments.length === 0) return 'deny';

  const denyBigrams = new Set([
    'git push',
    'git reset',
    'git clean',
    'rm -rf',
    'sudo rm',
    'sudo chmod',
    'sudo chown',
  ]);
  const askMonos = new Set(['git', 'npm', 'node', 'python', 'python3', 'bash', 'sh']);

  for (const segment of segments) {
    const tokens = tokenize(segment);
    if (tokens.length === 0) continue;
    const mono = tokens[0] ?? '';
    const bigram = tokens.length > 1 ? `${tokens[0]} ${tokens[1]}` : mono;

    if (denyBigrams.has(bigram)) return 'deny';
    if (mono === 'rm' && tokens.includes('-rf')) return 'deny';
    if (mono === 'curl' || mono === 'wget') {
      if (segment.includes('|')) return 'deny';
      return 'ask';
    }
    if (askMonos.has(mono)) return 'ask';
  }

  return 'ask';
};

const mergeDecision = (
  workspaceDecision: CommandDecision,
  userDecision: CommandDecision | null,
): CommandDecision => {
  const combined: CommandDecision[] = [workspaceDecision];
  if (userDecision) combined.push(userDecision);
  if (combined.includes('deny')) return 'deny';
  if (combined.includes('ask')) return 'ask';
  return 'allow';
};

const toCommandDecisionFromPolicy = (
  policy: VsCodeToolPermissionPolicy | null,
): CommandDecision | null => {
  if (policy === 'allow') return 'allow';
  if (policy === 'deny') return 'deny';
  return null;
};

const withTimeoutMs = (
  input: Record<string, unknown>,
  fallback: number,
  min: number,
  max: number,
): number => {
  const raw = typeof input.timeoutMs === 'number' ? input.timeoutMs : fallback;
  return clamp(Math.floor(raw), min, max);
};

export class VsCodeLocalToolsRuntime {
  private readonly deps: RuntimeDeps;
  private readonly pendingRequests = new Map<string, PendingPermissionRequest>();
  private readonly oneTimeAllowByToolCallId = new Set<string>();

  constructor(deps: RuntimeDeps) {
    this.deps = deps;
  }

  private getPolicies(): VsCodeToolPermissionEntry[] {
    const rows = this.deps.getGlobalState<unknown[]>(STORAGE_KEY_POLICIES, []);
    if (!Array.isArray(rows)) return [];
    const normalized: VsCodeToolPermissionEntry[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      const toolName = normalizeToolPattern(String(record.toolName ?? ''));
      const origin = normalizeOrigin(String(record.origin ?? ''));
      const policy = String(record.policy ?? '').toLowerCase();
      const pathPattern = normalizePathPattern(
        typeof record.pathPattern === 'string' ? record.pathPattern : null,
      );
      if (!toolName || !origin) continue;
      if (policy !== 'allow' && policy !== 'deny') continue;
      const updatedAtRaw = String(record.updatedAt ?? '').trim();
      const updatedAt =
        updatedAtRaw && Number.isFinite(Date.parse(updatedAtRaw))
          ? new Date(updatedAtRaw).toISOString()
          : new Date().toISOString();
      normalized.push({
        toolName,
        origin,
        policy,
        pathPattern,
        updatedAt,
      });
    }
    return normalized;
  }

  private async savePolicies(entries: VsCodeToolPermissionEntry[]): Promise<void> {
    await this.deps.updateGlobalState(STORAGE_KEY_POLICIES, entries);
  }

  private resolveUserPolicy(
    toolName: string,
    origin: string,
    targetPath: string | null,
  ): VsCodeToolPermissionPolicy | null {
    const entries = this.getPolicies().filter((entry) => {
      if (entry.origin !== '*' && entry.origin !== origin) return false;
      return matchesToolPattern(entry.toolName, toolName);
    });
    const withPath = entries.filter((entry) =>
      matchesPathPattern(entry.pathPattern, targetPath),
    );
    if (withPath.length === 0) return null;

    withPath.sort((a, b) => {
      const scoreA =
        (a.origin === '*' ? 0 : 10_000) +
        getPatternSpecificity(a.toolName) +
        getPathPatternSpecificity(a.pathPattern);
      const scoreB =
        (b.origin === '*' ? 0 : 10_000) +
        getPatternSpecificity(b.toolName) +
        getPathPatternSpecificity(b.pathPattern);
      if (scoreA !== scoreB) return scoreB - scoreA;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

    return withPath[0]?.policy ?? null;
  }

  private buildPermissionToolName(name: VsCodeLocalToolName, args: Record<string, unknown>): string {
    if (name !== 'bash') return name;
    const command = typeof args.command === 'string' ? args.command.trim() : '';
    if (!command) return 'bash';
    const segments = parseBashSegments(command);
    const first = segments[0] ?? '';
    const tokens = tokenize(first);
    if (tokens.length === 0) return 'bash';
    const mono = tokens[0] ?? '';
    const bigram = tokens.length > 1 ? `${tokens[0]} ${tokens[1]}` : mono;
    return `bash:${bigram}`;
  }

  private async resolvePermissionTargetPath(
    name: VsCodeLocalToolName,
    args: Record<string, unknown>,
  ): Promise<string | null> {
    if (
      name !== 'ls' &&
      name !== 'rg' &&
      name !== 'file_read' &&
      name !== 'file_edit' &&
      name !== 'git_diff'
    ) {
      return null;
    }
    const workspaceRoot = this.getWorkspaceRootOrThrow();
    const rawPath =
      typeof args.path === 'string'
        ? args.path
        : name === 'ls' || name === 'rg'
          ? '.'
          : '';
    if (!rawPath) return null;
    const resolved = await resolveRealPath(workspaceRoot, rawPath);
    const relative = path.relative(workspaceRoot, resolved) || '.';
    return relative.replace(/\\/g, '/');
  }

  private async evaluatePermission(input: {
    toolCallId: string;
    name: VsCodeLocalToolName;
    args: Record<string, unknown>;
  }): Promise<
    | { allowed: true }
    | { allowed: false; denied: true; reason: string }
    | { allowed: false; request: VsCodeToolPermissionRequest }
  > {
    const origin = ORIGIN_VSCODE_WORKSPACE;
    const permissionToolName = this.buildPermissionToolName(input.name, input.args);
    const targetPath = await this.resolvePermissionTargetPath(input.name, input.args).catch(
      () => null,
    );

    if (this.oneTimeAllowByToolCallId.has(input.toolCallId)) {
      this.oneTimeAllowByToolCallId.delete(input.toolCallId);
      return { allowed: true };
    }

    if (
      (input.name === 'file_read' || input.name === 'file_edit') &&
      isSensitivePath(targetPath)
    ) {
      return {
        allowed: false,
        denied: true,
        reason: `Permission denied for sensitive path: ${targetPath}.`,
      };
    }

    const workspaceDecision = defaultWorkspaceDecision(input.name, input.args);
    const userPolicy = this.resolveUserPolicy(
      permissionToolName,
      origin,
      targetPath,
    );
    const effective = mergeDecision(
      workspaceDecision,
      toCommandDecisionFromPolicy(userPolicy),
    );

    if (effective === 'deny') {
      return {
        allowed: false,
        denied: true,
        reason: `Permission denied for ${permissionToolName}.`,
      };
    }

    if (effective === 'allow') {
      return { allowed: true };
    }

    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const request: PendingPermissionRequest = {
      requestId,
      toolCallId: input.toolCallId,
      toolName: permissionToolName,
      origin,
      pathPattern: targetPath,
      details:
        input.name === 'bash'
          ? {
              command: typeof input.args.command === 'string' ? input.args.command : '',
            }
          : targetPath
            ? {
                path: targetPath,
              }
            : undefined,
    };
    this.pendingRequests.set(requestId, request);
    return {
      allowed: false,
      request: {
        requestId,
        toolName: request.toolName,
        origin: request.origin,
        details: request.details,
      },
    };
  }

  private getWorkspaceRootOrThrow(): string {
    const workspaceRoot = this.deps.getWorkspaceRoot();
    if (!workspaceRoot) {
      throw new Error('No workspace folder is open in VSCode.');
    }
    return workspaceRoot;
  }

  private async runBash(workspaceRoot: string, args: Record<string, unknown>): Promise<unknown> {
    const command = typeof args.command === 'string' ? args.command.trim() : '';
    if (!command) throw new Error('bash: command is required');
    const timeoutMs = withTimeoutMs(args, 15_000, 1_000, 60_000);
    let stdout = '';
    let stderr = '';
    try {
      const res = await execFile('bash', ['-lc', command], {
        cwd: workspaceRoot,
        timeout: timeoutMs,
        maxBuffer: 512 * 1024,
      });
      stdout = String(res.stdout ?? '');
      stderr = String(res.stderr ?? '');
    } catch (error) {
      if (!isMissingBinaryError(error, 'bash')) {
        throw error;
      }
      const res = await execFile('sh', ['-lc', command], {
        cwd: workspaceRoot,
        timeout: timeoutMs,
        maxBuffer: 512 * 1024,
      });
      stdout = String(res.stdout ?? '');
      stderr = String(res.stderr ?? '');
    }
    return {
      command,
      stdout: truncate(stdout),
      stderr: truncate(stderr),
    };
  }

  private async runLs(workspaceRoot: string, args: Record<string, unknown>): Promise<unknown> {
    const targetPath = await resolveRealPath(
      workspaceRoot,
      typeof args.path === 'string' ? args.path : undefined,
    );
    const includeHidden = Boolean(args.includeHidden);
    const depth = clamp(
      typeof args.depth === 'number' ? Math.floor(args.depth) : 1,
      0,
      MAX_LS_DEPTH,
    );

    const walk = async (currentPath: string, currentDepth: number): Promise<Array<Record<string, unknown>>> => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      const rows: Array<Record<string, unknown>> = [];
      for (const entry of entries) {
        if (!includeHidden && entry.name.startsWith('.')) continue;
        const fullPath = path.join(currentPath, entry.name);
        const relativePath = path.relative(workspaceRoot, fullPath) || '.';
        const stat = await fs.stat(fullPath);
        rows.push({
          name: entry.name,
          path: relativePath,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
        if (entry.isDirectory() && currentDepth < depth) {
          const nested = await walk(fullPath, currentDepth + 1);
          rows.push(...nested);
        }
      }
      return rows;
    };

    return {
      path: path.relative(workspaceRoot, targetPath) || '.',
      entries: (await walk(targetPath, 0)).slice(0, 500),
      truncated: false,
    };
  }

  private async runRg(workspaceRoot: string, args: Record<string, unknown>): Promise<unknown> {
    const pattern = typeof args.pattern === 'string' ? args.pattern.trim() : '';
    if (!pattern) throw new Error('rg: pattern is required');
    const targetPath = await resolveRealPath(
      workspaceRoot,
      typeof args.path === 'string' ? args.path : undefined,
    );
    const maxResults = clamp(
      typeof args.maxResults === 'number' ? Math.floor(args.maxResults) : 200,
      1,
      MAX_RG_RESULTS,
    );
    const offset = clamp(
      typeof args.offset === 'number' ? Math.floor(args.offset) : 0,
      0,
      MAX_RG_OFFSET,
    );
    const scanLimit = clamp(offset + maxResults, 1, MAX_RG_SCAN);
    const timeoutMs = withTimeoutMs(args, 10_000, 1_000, 30_000);

    const commandArgs = [
      '--line-number',
      '--no-heading',
      '--color',
      'never',
      '-m',
      String(scanLimit),
      pattern,
      targetPath,
    ];
    let stdout = '';
    let stderr = '';
    try {
      const res = await execFile('rg', commandArgs, {
        cwd: workspaceRoot,
        timeout: timeoutMs,
        maxBuffer: 512 * 1024,
      });
      stdout = String(res.stdout ?? '');
      stderr = String(res.stderr ?? '');
    } catch (error) {
      if (!isMissingBinaryError(error, 'rg')) {
        throw error;
      }
      const grepArgs = ['-R', '-n', pattern, targetPath];
      const res = await execFile('grep', grepArgs, {
        cwd: workspaceRoot,
        timeout: timeoutMs,
        maxBuffer: 512 * 1024,
      });
      stdout = String(res.stdout ?? '');
      stderr = String(res.stderr ?? '');
    }
    const lines = String(stdout ?? '')
      .split(/\r?\n/g)
      .filter((line) => line.trim().length > 0);
    const paged = lines.slice(offset, offset + maxResults);
    const nextOffset = offset + maxResults < lines.length ? offset + maxResults : null;
    return {
      pattern,
      path: path.relative(workspaceRoot, targetPath) || '.',
      offset,
      results: paged,
      nextOffset,
      truncated: nextOffset !== null,
      stderr: truncate(String(stderr ?? '')),
    };
  }

  private async runFileRead(workspaceRoot: string, args: Record<string, unknown>): Promise<unknown> {
    const targetPath = await resolveRealPath(
      workspaceRoot,
      typeof args.path === 'string' ? args.path : undefined,
    );
    const raw = await fs.readFile(targetPath, 'utf8');
    const full = Boolean(args.full);
    if (full) {
      return {
        path: path.relative(workspaceRoot, targetPath) || '.',
        content: truncate(raw, MAX_FILE_READ_CHARS),
        truncated: raw.length > MAX_FILE_READ_CHARS,
      };
    }

    const startLine = clamp(
      typeof args.startLine === 'number' ? Math.floor(args.startLine) : 1,
      1,
      1_000_000,
    );
    const lineCount = clamp(
      typeof args.lineCount === 'number' ? Math.floor(args.lineCount) : 120,
      1,
      500,
    );
    const lines = raw.split(/\r?\n/g);
    const startIndex = startLine - 1;
    const endIndex = Math.min(startIndex + lineCount, lines.length);
    const selected = lines.slice(startIndex, endIndex).join('\n');
    return {
      path: path.relative(workspaceRoot, targetPath) || '.',
      startLine,
      lineCount,
      content: selected,
      totalLines: lines.length,
    };
  }

  private async runFileEdit(workspaceRoot: string, args: Record<string, unknown>): Promise<unknown> {
    const mode = typeof args.mode === 'string' ? args.mode.trim().toLowerCase() : 'write';
    if (mode === 'apply_patch') {
      const patchText = typeof args.patch === 'string' ? args.patch : '';
      if (!patchText.trim()) {
        throw new Error('file_edit(apply_patch): patch is required');
      }
      const tempPatchPath = path.join(
        workspaceRoot,
        `.topai_patch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.diff`,
      );
      await fs.writeFile(tempPatchPath, patchText, 'utf8');
      try {
        try {
          await execFile('git', ['apply', '--check', '--whitespace=nowarn', tempPatchPath], {
            cwd: workspaceRoot,
            timeout: 15_000,
            maxBuffer: 256 * 1024,
          });
          await execFile('git', ['apply', '--whitespace=nowarn', tempPatchPath], {
            cwd: workspaceRoot,
            timeout: 15_000,
            maxBuffer: 256 * 1024,
          });
          return {
            mode,
            applied: true,
          };
        } catch (error) {
          if (!isMissingBinaryError(error, 'git')) {
            throw error;
          }
          return applyUnifiedPatchFallback(workspaceRoot, patchText);
        }
      } finally {
        await fs.unlink(tempPatchPath).catch(() => undefined);
      }
    }

    const targetPath = await resolveRealPath(
      workspaceRoot,
      typeof args.path === 'string' ? args.path : undefined,
    );
    const previous = await fs.readFile(targetPath, 'utf8').catch(() => '');

    if (mode === 'write') {
      const content = typeof args.content === 'string' ? args.content : '';
      await fs.writeFile(targetPath, content, 'utf8');
      return {
        mode,
        path: path.relative(workspaceRoot, targetPath) || '.',
        bytesWritten: Buffer.byteLength(content, 'utf8'),
      };
    }

    if (mode === 'edit') {
      const find = typeof args.find === 'string' ? args.find : '';
      const replace = typeof args.replace === 'string' ? args.replace : '';
      if (!find) {
        throw new Error('file_edit(edit): find is required');
      }
      const replaceAll = Boolean(args.replaceAll);
      const next = replaceAll
        ? previous.split(find).join(replace)
        : previous.replace(find, replace);
      await fs.writeFile(targetPath, next, 'utf8');
      return {
        mode,
        path: path.relative(workspaceRoot, targetPath) || '.',
        changed: next !== previous,
        replaceAll,
      };
    }

    throw new Error(`file_edit: unsupported mode ${mode}`);
  }

  private async runGitStatus(workspaceRoot: string): Promise<unknown> {
    const { stdout } = await execFile('git', ['status', '--short', '--branch'], {
      cwd: workspaceRoot,
      timeout: 10_000,
      maxBuffer: 256 * 1024,
    });
    return {
      output: truncate(String(stdout ?? '')),
    };
  }

  private async runGitDiff(workspaceRoot: string, args: Record<string, unknown>): Promise<unknown> {
    const ref = typeof args.ref === 'string' ? args.ref.trim() : '';
    const targetPath =
      typeof args.path === 'string' && args.path.trim().length > 0
        ? await resolveRealPath(workspaceRoot, args.path)
        : null;
    const gitArgs = ['diff'];
    if (ref) gitArgs.push(ref);
    if (targetPath) {
      gitArgs.push('--', path.relative(workspaceRoot, targetPath) || '.');
    }
    const { stdout } = await execFile('git', gitArgs, {
      cwd: workspaceRoot,
      timeout: 10_000,
      maxBuffer: 512 * 1024,
    });
    return {
      ref: ref || null,
      path: targetPath ? path.relative(workspaceRoot, targetPath) || '.' : null,
      diff: truncate(String(stdout ?? '')),
    };
  }

  private async executeTool(input: {
    name: VsCodeLocalToolName;
    args: Record<string, unknown>;
  }): Promise<unknown> {
    const workspaceRoot = this.getWorkspaceRootOrThrow();
    if (input.name === 'bash') return this.runBash(workspaceRoot, input.args);
    if (input.name === 'ls') return this.runLs(workspaceRoot, input.args);
    if (input.name === 'rg') return this.runRg(workspaceRoot, input.args);
    if (input.name === 'file_read') return this.runFileRead(workspaceRoot, input.args);
    if (input.name === 'file_edit') return this.runFileEdit(workspaceRoot, input.args);
    if (input.name === 'git_status') return this.runGitStatus(workspaceRoot);
    if (input.name === 'git_diff') return this.runGitDiff(workspaceRoot, input.args);
    throw new Error(`Unsupported local tool: ${input.name}`);
  }

  async execute(payload: unknown): Promise<{
    ok: boolean;
    result?: unknown;
    error?: string;
    permissionRequest?: VsCodeToolPermissionRequest;
  }> {
    const input = (payload ?? {}) as ExecuteInput;
    const toolCallId = String(input.toolCallId ?? '').trim();
    const rawName = String(input.name ?? '').trim();
    const args =
      input.args && typeof input.args === 'object' && !Array.isArray(input.args)
        ? (input.args as Record<string, unknown>)
        : {};

    if (!toolCallId) {
      return { ok: false, error: 'toolCallId is required.' };
    }
    if (!isToolName(rawName)) {
      return { ok: false, error: `Unknown local tool: ${rawName}` };
    }

    const permission = await this.evaluatePermission({
      toolCallId,
      name: rawName,
      args,
    });

    if (!permission.allowed) {
      if ('request' in permission) {
        return {
          ok: false,
          error: 'permission_required',
          permissionRequest: permission.request,
        };
      }
      return { ok: false, error: permission.reason };
    }

    try {
      const result = await this.executeTool({
        name: rawName,
        args,
      });
      return {
        ok: true,
        result,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async decide(payload: unknown): Promise<{ ok: boolean; error?: string }> {
    const input = (payload ?? {}) as DecisionInput;
    const requestId = String(input.requestId ?? '').trim();
    const decision = String(input.decision ?? '').trim().toLowerCase();
    if (!requestId) return { ok: false, error: 'requestId is required.' };

    if (
      decision !== 'allow_once' &&
      decision !== 'deny_once' &&
      decision !== 'allow_always' &&
      decision !== 'deny_always'
    ) {
      return { ok: false, error: 'Invalid decision.' };
    }

    const pending = this.pendingRequests.get(requestId);
    if (!pending) return { ok: false, error: 'Unknown tool permission request.' };
    this.pendingRequests.delete(requestId);

    if (decision === 'allow_once') {
      this.oneTimeAllowByToolCallId.add(pending.toolCallId);
      return { ok: true };
    }
    if (decision === 'deny_once') {
      return { ok: true };
    }

    const entries = this.getPolicies().filter(
      (entry) => !(entry.toolName === pending.toolName && entry.origin === pending.origin),
    );
    entries.push({
      toolName: pending.toolName,
      origin: pending.origin,
      policy: decision === 'allow_always' ? 'allow' : 'deny',
      pathPattern: pending.pathPattern ?? null,
      updatedAt: new Date().toISOString(),
    });
    await this.savePolicies(entries);
    return { ok: true };
  }

  async listPolicies(): Promise<{ ok: boolean; items: VsCodeToolPermissionEntry[] }> {
    return {
      ok: true,
      items: this.getPolicies().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  }

  async upsertPolicy(payload: unknown): Promise<{
    ok: boolean;
    item?: VsCodeToolPermissionEntry;
    error?: string;
  }> {
    const input = (payload ?? {}) as PolicyInput;
    const toolName = normalizeToolPattern(String(input.toolName ?? ''));
    const origin = normalizeOrigin(String(input.origin ?? ''));
    const policy = String(input.policy ?? '').trim().toLowerCase();
    const pathPattern = normalizePathPattern(input.pathPattern);
    if (!toolName) return { ok: false, error: 'toolName is required.' };
    if (!origin) return { ok: false, error: 'origin is invalid.' };
    if (policy !== 'allow' && policy !== 'deny') {
      return { ok: false, error: 'policy must be allow or deny.' };
    }

    const entries = this.getPolicies().filter(
      (entry) =>
        !(
          entry.toolName === toolName &&
          entry.origin === origin &&
          (entry.pathPattern ?? null) === (pathPattern ?? null)
        ),
    );
    const item: VsCodeToolPermissionEntry = {
      toolName,
      origin,
      policy,
      pathPattern,
      updatedAt: new Date().toISOString(),
    };
    entries.push(item);
    await this.savePolicies(entries);
    return { ok: true, item };
  }

  async deletePolicy(payload: unknown): Promise<{ ok: boolean; error?: string }> {
    const input = (payload ?? {}) as PolicyDeleteInput;
    const toolName = normalizeToolPattern(String(input.toolName ?? ''));
    const origin = normalizeOrigin(String(input.origin ?? ''));
    const pathPattern = normalizePathPattern(input.pathPattern);
    if (!toolName) return { ok: false, error: 'toolName is required.' };
    if (!origin) return { ok: false, error: 'origin is invalid.' };

    const entries = this.getPolicies().filter(
      (entry) =>
        !(
          entry.toolName === toolName &&
          entry.origin === origin &&
          (entry.pathPattern ?? null) === (pathPattern ?? null)
        ),
    );
    await this.savePolicies(entries);
    return { ok: true };
  }
}

export const createVsCodeLocalToolsRuntime = (
  context: ExtensionContext,
  options?: {
    getWorkspaceRoot?: () => string | null;
  },
): VsCodeLocalToolsRuntime => {
  return new VsCodeLocalToolsRuntime({
    getWorkspaceRoot: () => options?.getWorkspaceRoot?.() ?? null,
    getGlobalState: <T>(key: string, fallback: T): T =>
      context.globalState.get<T>(key, fallback),
    updateGlobalState: (key: string, value: unknown): Thenable<void> =>
      context.globalState.update(key, value),
  });
};

export const VSCODE_CODE_TOOL_DEFINITIONS: Array<{
  name: VsCodeLocalToolName;
  description: string;
  parameters: Record<string, unknown>;
}> = [
  {
    name: 'bash',
    description:
      'Execute a shell command in the current workspace. Requires permission policy checks.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 60000 },
      },
      required: ['command'],
    },
  },
  {
    name: 'ls',
    description:
      'List files and directories in the current workspace with bounded recursion depth.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        depth: { type: 'integer', minimum: 0, maximum: 4 },
        includeHidden: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    name: 'rg',
    description:
      'Search text in workspace files using ripgrep with bounded results.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' },
        maxResults: { type: 'integer', minimum: 1, maximum: 400 },
        offset: { type: 'integer', minimum: 0, maximum: 2000 },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 30000 },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'file_read',
    description:
      'Read file content with windowed defaults and optional full mode.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        startLine: { type: 'integer', minimum: 1 },
        lineCount: { type: 'integer', minimum: 1, maximum: 500 },
        full: { type: 'boolean' },
      },
      required: ['path'],
    },
  },
  {
    name: 'file_edit',
    description:
      'Apply deterministic file edits with mode=write|edit|apply_patch under permission policy checks.',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['write', 'edit', 'apply_patch'] },
        path: { type: 'string' },
        patch: { type: 'string' },
        content: { type: 'string' },
        find: { type: 'string' },
        replace: { type: 'string' },
        replaceAll: { type: 'boolean' },
      },
      required: ['mode'],
    },
  },
  {
    name: 'git_status',
    description: 'Read-only git status for the current workspace.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'git_diff',
    description: 'Read-only git diff with optional path/ref scope.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        path: { type: 'string' },
      },
      required: [],
    },
  },
];

export const vscodeCodeToolDefinitions = VSCODE_CODE_TOOL_DEFINITIONS;
export const vscodeCodeToolNames = new Set(
  VSCODE_CODE_TOOL_DEFINITIONS.map((entry) => entry.name),
);
