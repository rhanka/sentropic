import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  createTopAiVsCodeRequestHandler,
  type RuntimeHttpRequestResult,
  type TopAiRuntimeConfig,
  type TopAiVsCodeCommand,
} from './host-handler';
import { createVsCodeLocalToolsRuntime } from './local-tools';
import {
  runVsCodeSseProxy,
  type VsCodeSseProxyMessage,
} from './stream-proxy';
import {
  resolveCodeAgentPromptProfile,
} from '../src/lib/vscode/code-agent-profile';
import { resolvePersistedVsCodeSessionToken } from './session-token-persistence';

const COMMAND_OPEN_PANEL = 'topai.openPanel';
const VIEW_ID = 'topai.chatView';
const VIEW_CONTAINER_ID = 'topai';
const SECRET_SESSION_TOKEN_KEY = 'topai.sessionToken';
const STATE_KEY_RUNTIME_CONFIG = 'topai.runtimeConfig';
const STATE_KEY_WORKSPACE_PROMPT_OVERRIDES = 'topai.workspacePromptOverrides';
const STATE_KEY_PROJECT_WORKSPACE_MAPPINGS = 'topai.projectWorkspaceMappings';
const PROJECT_WORKSPACE_MAPPING_SYNC_TTL_MS = 60_000;

declare const __TOPAI_DEFAULT_API_BASE_URL__: string | undefined;
declare const __TOPAI_DEFAULT_APP_BASE_URL__: string | undefined;

const DEFAULT_API_BASE_URL =
  __TOPAI_DEFAULT_API_BASE_URL__ || 'http://localhost:8787/api/v1';
const DEFAULT_APP_BASE_URL =
  __TOPAI_DEFAULT_APP_BASE_URL__ || 'http://localhost:5173';
const DEFAULT_INSTRUCTION_INCLUDE_PATTERNS = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.cursor/rules/*.mdc',
  '.github/copilot-instructions.md',
  '.github/instructions/*.instructions.md',
];
const INSTRUCTION_DISCOVERY_EXCLUDE_GLOB =
  '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**}';
const INSTRUCTION_DISCOVERY_MAX_FILES = 16;
const INSTRUCTION_DISCOVERY_MAX_FILE_CHARS = 12_000;

const defaultConfig: TopAiRuntimeConfig = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  appBaseUrl: DEFAULT_APP_BASE_URL,
  wsBaseUrl: '',
  sessionToken: '',
  codexSignInUrl: 'https://chatgpt.com/auth/login?next=/codex',
  codeAgentPromptDefault: '',
  codeAgentPromptGlobal: '',
  codeAgentPromptWorkspace: '',
  codeAgentPromptEffective: '',
  codeAgentPromptSource: 'default',
  instructionIncludePatterns: [...DEFAULT_INSTRUCTION_INCLUDE_PATTERNS],
  workspaceScopeKey: '',
  workspaceScopeLabel: '',
  projectFingerprint: '',
  workspaceScopeWorkspaceId: '',
  workspaceScopeLastWorkspaceId: '',
  codeWorkspaces: [],
};

type RuntimeConfigPatchPayload = {
  apiBaseUrl?: string;
  appBaseUrl?: string;
  wsBaseUrl?: string;
  sessionToken?: string;
  codeAgentPromptGlobal?: string;
  codeAgentPromptWorkspace?: string;
  instructionIncludePatterns?: string[];
};

type WorkspacePromptOverrideMap = Record<string, string>;
type VsCodeInstructionFile = {
  path: string;
  content: string;
};
type VsCodeCodeAgentSystemContext = {
  workingDirectory?: string;
  isGitRepo?: boolean;
  gitBranch?: string;
  platform?: string;
  osVersion?: string;
  shell?: string;
  clientDateIso?: string;
  clientTimezone?: string;
};
type VsCodeCodeAgentPayload = {
  source: 'vscode';
  workspaceKey?: string;
  workspaceLabel?: string;
  promptGlobalOverride?: string;
  promptWorkspaceOverride?: string;
  instructionIncludePatterns?: string[];
  instructionFiles?: VsCodeInstructionFile[];
  systemContext?: VsCodeCodeAgentSystemContext;
};
type WorkspaceScopeInfo = {
  workspaceScopeKey: string;
  workspaceScopeLabel: string;
  repositoryName: string;
  projectFingerprint: string;
};
type CodeWorkspaceSummary = {
  id: string;
  name: string;
  role: 'viewer' | 'commenter' | 'editor' | 'admin';
};
type ProjectWorkspaceMappingRecord = {
  projectFingerprint: string;
  mappedWorkspaceId: string | null;
  mappedWorkspaceName: string | null;
  lastWorkspaceId: string | null;
  codeWorkspaces: CodeWorkspaceSummary[];
  syncedAt: number;
};
type ProjectWorkspaceMappingsStore = {
  records: Record<string, ProjectWorkspaceMappingRecord>;
};

const projectWorkspaceSyncInFlight = new Map<string, Promise<ProjectWorkspaceMappingRecord | null>>();

const normalizeConfigString = (value: unknown, fallback = ''): string => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const normalizeInstructionIncludePatterns = (value: unknown): string[] => {
  const rawItems = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(/\r?\n|,/g) : []);
  const deduped: string[] = [];
  for (const entry of rawItems) {
    const pattern = typeof entry === 'string' ? entry.trim() : '';
    if (!pattern) continue;
    if (deduped.includes(pattern)) continue;
    deduped.push(pattern);
  }
  return deduped.length > 0
    ? deduped.slice(0, 64)
    : [...DEFAULT_INSTRUCTION_INCLUDE_PATTERNS];
};

const normalizeWorkspacePath = (value: string): string =>
  process.platform === 'win32' ? value.toLowerCase() : value;

const selectActiveWorkspaceFolder = (): vscode.WorkspaceFolder | null => {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return null;
  const activeUri = vscode.window.activeTextEditor?.document?.uri;
  if (activeUri) {
    const activeFolder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (activeFolder) return activeFolder;
  }
  return folders[0];
};

const resolveGitDirPath = async (workspaceFsPath: string): Promise<string | null> => {
  const gitEntryPath = path.join(workspaceFsPath, '.git');
  try {
    const stat = await fs.stat(gitEntryPath);
    if (stat.isDirectory()) return gitEntryPath;
    if (!stat.isFile()) return null;
    const fileContent = await fs.readFile(gitEntryPath, 'utf8');
    const match = fileContent.match(/gitdir:\s*(.+)/i);
    if (!match?.[1]) return null;
    return path.resolve(workspaceFsPath, match[1].trim());
  } catch {
    return null;
  }
};

const readGitOriginUrl = async (workspaceFsPath: string): Promise<string | null> => {
  const gitDirPath = await resolveGitDirPath(workspaceFsPath);
  if (!gitDirPath) return null;
  try {
    const configPath = path.join(gitDirPath, 'config');
    const configContent = await fs.readFile(configPath, 'utf8');
    const lines = configContent.split(/\r?\n/);
    let inOriginSection = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith('[') && line.endsWith(']')) {
        inOriginSection = line.toLowerCase() === '[remote "origin"]';
        continue;
      }
      if (!inOriginSection) continue;
      const match = line.match(/^url\s*=\s*(.+)$/i);
      if (!match?.[1]) continue;
      return match[1].trim();
    }
    return null;
  } catch {
    return null;
  }
};

const readGitBranch = async (workspaceFsPath: string): Promise<string | null> => {
  const gitDirPath = await resolveGitDirPath(workspaceFsPath);
  if (!gitDirPath) return null;
  try {
    const headPath = path.join(gitDirPath, 'HEAD');
    const headContent = (await fs.readFile(headPath, 'utf8')).trim();
    if (!headContent) return null;
    if (!headContent.startsWith('ref:')) {
      return headContent.slice(0, 12);
    }
    const refPath = headContent.replace(/^ref:\s*/i, '').trim();
    if (!refPath) return null;
    const match = refPath.match(/refs\/heads\/(.+)$/i);
    return match?.[1]?.trim() || refPath.split('/').pop()?.trim() || null;
  } catch {
    return null;
  }
};

const computeProjectFingerprint = async (
  workspaceFsPath: string,
): Promise<string> => {
  const normalizedPath = normalizeWorkspacePath(workspaceFsPath);
  const originUrl = await readGitOriginUrl(workspaceFsPath);
  const seed = originUrl
    ? `git:${originUrl.trim().toLowerCase()}`
    : `path:${normalizedPath}`;
  return createHash('sha256').update(seed).digest('hex').slice(0, 40);
};

const deriveRepositoryName = (input: {
  originUrl: string | null;
  workspaceLabel: string;
}): string => {
  const rawOrigin = (input.originUrl ?? '').trim();
  if (!rawOrigin) return input.workspaceLabel;
  const normalized = rawOrigin
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  const lastSegment = normalized.split(/[/:]/).pop() ?? '';
  const repositoryName = lastSegment.replace(/\.git$/i, '').trim();
  return repositoryName.length > 0 ? repositoryName : input.workspaceLabel;
};

const resolveWorkspaceScope = async (): Promise<WorkspaceScopeInfo> => {
  const folder = selectActiveWorkspaceFolder();
  if (!folder) {
    return {
      workspaceScopeKey: '',
      workspaceScopeLabel: '',
      repositoryName: '',
      projectFingerprint: '',
    };
  }
  const fsPath = folder.uri.fsPath || folder.uri.toString();
  const workspaceScopeKey = normalizeWorkspacePath(fsPath);
  const workspaceScopeLabel = folder.name || fsPath;
  const originUrl = await readGitOriginUrl(fsPath);
  return {
    workspaceScopeKey,
    workspaceScopeLabel,
    repositoryName: deriveRepositoryName({
      originUrl,
      workspaceLabel: workspaceScopeLabel,
    }),
    projectFingerprint: await computeProjectFingerprint(fsPath),
  };
};

const readWorkspacePromptOverrideMap = (
  context: vscode.ExtensionContext,
): WorkspacePromptOverrideMap => {
  const raw = context.globalState.get<WorkspacePromptOverrideMap>(
    STATE_KEY_WORKSPACE_PROMPT_OVERRIDES,
    {},
  );
  if (!raw || typeof raw !== 'object') return {};
  const out: WorkspacePromptOverrideMap = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== 'string' || !key.trim()) continue;
    if (typeof value !== 'string') continue;
    out[key] = value;
  }
  return out;
};

const readProjectWorkspaceMappingsStore = (
  context: vscode.ExtensionContext,
): ProjectWorkspaceMappingsStore => {
  const raw = context.globalState.get<ProjectWorkspaceMappingsStore>(
    STATE_KEY_PROJECT_WORKSPACE_MAPPINGS,
    { records: {} },
  );
  if (!raw || typeof raw !== 'object') return { records: {} };
  const sourceRecords =
    raw.records && typeof raw.records === 'object'
      ? raw.records
      : {};
  const records: Record<string, ProjectWorkspaceMappingRecord> = {};
  for (const [fingerprint, value] of Object.entries(sourceRecords)) {
    if (typeof fingerprint !== 'string' || fingerprint.trim().length < 8) continue;
    if (!value || typeof value !== 'object') continue;
    const record = value as Partial<ProjectWorkspaceMappingRecord>;
    const mappedWorkspaceId =
      typeof record.mappedWorkspaceId === 'string' && record.mappedWorkspaceId.trim().length > 0
        ? record.mappedWorkspaceId.trim()
        : null;
    const mappedWorkspaceName =
      typeof record.mappedWorkspaceName === 'string' && record.mappedWorkspaceName.trim().length > 0
        ? record.mappedWorkspaceName.trim()
        : null;
    const lastWorkspaceId =
      typeof record.lastWorkspaceId === 'string' && record.lastWorkspaceId.trim().length > 0
        ? record.lastWorkspaceId.trim()
        : null;
    const codeWorkspaces = Array.isArray(record.codeWorkspaces)
      ? record.codeWorkspaces
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null;
            const row = entry as Partial<CodeWorkspaceSummary>;
            if (
              typeof row.id !== 'string' ||
              typeof row.name !== 'string' ||
              (row.role !== 'viewer' &&
                row.role !== 'commenter' &&
                row.role !== 'editor' &&
                row.role !== 'admin')
            ) {
              return null;
            }
            return {
              id: row.id.trim(),
              name: row.name.trim(),
              role: row.role,
            } as CodeWorkspaceSummary;
          })
          .filter((entry): entry is CodeWorkspaceSummary => Boolean(entry))
      : [];
    records[fingerprint] = {
      projectFingerprint: fingerprint,
      mappedWorkspaceId,
      mappedWorkspaceName,
      lastWorkspaceId,
      codeWorkspaces,
      syncedAt:
        typeof record.syncedAt === 'number' && Number.isFinite(record.syncedAt)
          ? record.syncedAt
          : 0,
    };
  }
  return { records };
};

const writeProjectWorkspaceMappingsStore = async (
  context: vscode.ExtensionContext,
  store: ProjectWorkspaceMappingsStore,
): Promise<void> => {
  await context.globalState.update(STATE_KEY_PROJECT_WORKSPACE_MAPPINGS, store);
};

const upsertProjectWorkspaceMappingRecord = async (
  context: vscode.ExtensionContext,
  record: ProjectWorkspaceMappingRecord,
): Promise<void> => {
  const store = readProjectWorkspaceMappingsStore(context);
  store.records[record.projectFingerprint] = record;
  await writeProjectWorkspaceMappingsStore(context, store);
};

const normalizeProjectWorkspaceMappingRecord = (
  payload: unknown,
  fallbackProjectFingerprint: string,
): ProjectWorkspaceMappingRecord | null => {
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as Partial<ProjectWorkspaceMappingRecord>;
  const codeWorkspaces = Array.isArray(row.codeWorkspaces)
    ? row.codeWorkspaces
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const value = entry as Partial<CodeWorkspaceSummary>;
          if (
            typeof value.id !== 'string' ||
            typeof value.name !== 'string' ||
            (value.role !== 'viewer' &&
              value.role !== 'commenter' &&
              value.role !== 'editor' &&
              value.role !== 'admin')
          ) {
            return null;
          }
          return {
            id: value.id.trim(),
            name: value.name.trim(),
            role: value.role,
          } as CodeWorkspaceSummary;
        })
        .filter((entry): entry is CodeWorkspaceSummary => Boolean(entry))
    : [];
  const mappedWorkspaceId =
    typeof row.mappedWorkspaceId === 'string' && row.mappedWorkspaceId.trim().length > 0
      ? row.mappedWorkspaceId.trim()
      : null;
  const mappedWorkspaceName =
    typeof row.mappedWorkspaceName === 'string' && row.mappedWorkspaceName.trim().length > 0
      ? row.mappedWorkspaceName.trim()
      : null;
  const lastWorkspaceId =
    typeof row.lastWorkspaceId === 'string' && row.lastWorkspaceId.trim().length > 0
      ? row.lastWorkspaceId.trim()
      : null;
  return {
    projectFingerprint:
      typeof row.projectFingerprint === 'string' && row.projectFingerprint.trim().length > 0
        ? row.projectFingerprint.trim()
        : fallbackProjectFingerprint,
    mappedWorkspaceId,
    mappedWorkspaceName,
    lastWorkspaceId,
    codeWorkspaces,
    syncedAt: Date.now(),
  };
};

const requestProjectWorkspaceMappingRecord = async (params: {
  apiBaseUrl: string;
  sessionToken: string;
  projectFingerprint: string;
  method: 'GET' | 'PUT' | 'POST';
  path:
    | '/vscode-extension/workspace-mapping'
    | '/vscode-extension/workspace-mapping/code-workspace'
    | '/vscode-extension/workspace-mapping/not-now';
  body?: Record<string, unknown>;
}): Promise<ProjectWorkspaceMappingRecord | null> => {
  const apiBaseUrl = params.apiBaseUrl.replace(/\/$/, '');
  const url = new URL(`${apiBaseUrl}${params.path}`);
  if (params.method === 'GET') {
    url.searchParams.set('project_fingerprint', params.projectFingerprint);
  }
  try {
    const response = await fetch(url.toString(), {
      method: params.method,
      headers: {
        Authorization: `Bearer ${params.sessionToken}`,
        ...(params.method === 'GET' ? {} : { 'content-type': 'application/json' }),
      },
      body:
        params.method === 'GET' ? undefined : JSON.stringify(params.body ?? {}),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return normalizeProjectWorkspaceMappingRecord(payload, params.projectFingerprint);
  } catch {
    return null;
  }
};

const fetchProjectWorkspaceMappingRecord = async (params: {
  apiBaseUrl: string;
  sessionToken: string;
  projectFingerprint: string;
}): Promise<ProjectWorkspaceMappingRecord | null> =>
  requestProjectWorkspaceMappingRecord({
    apiBaseUrl: params.apiBaseUrl,
    sessionToken: params.sessionToken,
    projectFingerprint: params.projectFingerprint,
    method: 'GET',
    path: '/vscode-extension/workspace-mapping',
  });

const putProjectWorkspaceMappingRecord = async (params: {
  apiBaseUrl: string;
  sessionToken: string;
  projectFingerprint: string;
  workspaceId: string;
}): Promise<ProjectWorkspaceMappingRecord | null> =>
  requestProjectWorkspaceMappingRecord({
    apiBaseUrl: params.apiBaseUrl,
    sessionToken: params.sessionToken,
    projectFingerprint: params.projectFingerprint,
    method: 'PUT',
    path: '/vscode-extension/workspace-mapping',
    body: {
      projectFingerprint: params.projectFingerprint,
      workspaceId: params.workspaceId,
    },
  });

const createProjectCodeWorkspaceMappingRecord = async (params: {
  apiBaseUrl: string;
  sessionToken: string;
  projectFingerprint: string;
  name?: string;
  repositoryName?: string;
}): Promise<ProjectWorkspaceMappingRecord | null> =>
  requestProjectWorkspaceMappingRecord({
    apiBaseUrl: params.apiBaseUrl,
    sessionToken: params.sessionToken,
    projectFingerprint: params.projectFingerprint,
    method: 'POST',
    path: '/vscode-extension/workspace-mapping/code-workspace',
    body: {
      projectFingerprint: params.projectFingerprint,
      ...(typeof params.name === 'string' && params.name.trim().length > 0
        ? { name: params.name.trim() }
        : {}),
      ...(typeof params.repositoryName === 'string' &&
      params.repositoryName.trim().length > 0
        ? { repositoryName: params.repositoryName.trim() }
        : {}),
    },
  });

const notNowProjectWorkspaceMappingRecord = async (params: {
  apiBaseUrl: string;
  sessionToken: string;
  projectFingerprint: string;
}): Promise<ProjectWorkspaceMappingRecord | null> =>
  requestProjectWorkspaceMappingRecord({
    apiBaseUrl: params.apiBaseUrl,
    sessionToken: params.sessionToken,
    projectFingerprint: params.projectFingerprint,
    method: 'POST',
    path: '/vscode-extension/workspace-mapping/not-now',
    body: {
      projectFingerprint: params.projectFingerprint,
    },
  });

const getOrSyncProjectWorkspaceMapping = async (params: {
  context: vscode.ExtensionContext;
  apiBaseUrl: string;
  sessionToken: string;
  projectFingerprint: string;
}): Promise<ProjectWorkspaceMappingRecord | null> => {
  const { context, apiBaseUrl, sessionToken, projectFingerprint } = params;
  if (!projectFingerprint.trim()) return null;
  const store = readProjectWorkspaceMappingsStore(context);
  const cached = store.records[projectFingerprint];
  const cacheFresh =
    cached &&
    Date.now() - cached.syncedAt < PROJECT_WORKSPACE_MAPPING_SYNC_TTL_MS;
  if (cacheFresh) return cached;
  if (!sessionToken.trim()) return cached ?? null;

  const inflightKey = `${projectFingerprint}:${apiBaseUrl}`;
  const existingInflight = projectWorkspaceSyncInFlight.get(inflightKey);
  if (existingInflight) return existingInflight;

  const syncPromise = (async () => {
    const fetched = await fetchProjectWorkspaceMappingRecord({
      apiBaseUrl,
      sessionToken,
      projectFingerprint,
    });
    if (!fetched) return cached ?? null;
    const nextStore = readProjectWorkspaceMappingsStore(context);
    nextStore.records[projectFingerprint] = fetched;
    await writeProjectWorkspaceMappingsStore(context, nextStore);
    return fetched;
  })();

  projectWorkspaceSyncInFlight.set(inflightKey, syncPromise);
  try {
    return await syncPromise;
  } finally {
    projectWorkspaceSyncInFlight.delete(inflightKey);
  }
};

const buildInstructionDiscoveryPatterns = (
  includePatterns: string[],
): string[] => {
  const deduped: string[] = [];
  for (const pattern of includePatterns) {
    const normalized = pattern.trim();
    if (!normalized) continue;
    if (deduped.includes(normalized)) continue;
    deduped.push(normalized);
  }
  return deduped;
};

const fetchCodeAgentPromptDefault = async (params: {
  apiBaseUrl: string;
  sessionToken: string;
}): Promise<string> => {
  const token = params.sessionToken.trim();
  if (!token) return '';
  const normalizedBase = params.apiBaseUrl.replace(/\/$/, '');
  const targetUrl = `${normalizedBase}/vscode-extension/code-agent-prompt-profile`;
  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) return '';
    const payload = (await response.json()) as {
      defaultPrompt?: unknown;
    };
    if (typeof payload.defaultPrompt !== 'string') return '';
    return payload.defaultPrompt.trim();
  } catch {
    return '';
  }
};

const readRuntimeConfig = async (
  context: vscode.ExtensionContext,
): Promise<TopAiRuntimeConfig> => {
  const config = vscode.workspace.getConfiguration('topai');
  const persisted = context.globalState.get<RuntimeConfigPatchPayload>(
    STATE_KEY_RUNTIME_CONFIG,
    {},
  );
  const apiBaseUrl = normalizeConfigString(
    persisted.apiBaseUrl ??
      config.get<string>('apiBaseUrl', defaultConfig.apiBaseUrl),
    defaultConfig.apiBaseUrl,
  );
  const appBaseUrl = normalizeConfigString(
    persisted.appBaseUrl ??
      config.get<string>('appBaseUrl', defaultConfig.appBaseUrl),
    defaultConfig.appBaseUrl,
  );
  const wsBaseUrl = normalizeConfigString(
    persisted.wsBaseUrl ??
      config.get<string>('wsBaseUrl', defaultConfig.wsBaseUrl),
    defaultConfig.wsBaseUrl,
  );
  const codeAgentPromptGlobal =
    typeof persisted.codeAgentPromptGlobal === 'string'
      ? persisted.codeAgentPromptGlobal
      : defaultConfig.codeAgentPromptGlobal;
  const instructionIncludePatterns = normalizeInstructionIncludePatterns(
    persisted.instructionIncludePatterns,
  );
  const { workspaceScopeKey, workspaceScopeLabel, projectFingerprint } =
    await resolveWorkspaceScope();
  const workspacePromptOverrides = readWorkspacePromptOverrideMap(context);
  const codeAgentPromptWorkspace =
    workspaceScopeKey && typeof workspacePromptOverrides[workspaceScopeKey] === 'string'
      ? workspacePromptOverrides[workspaceScopeKey]
      : defaultConfig.codeAgentPromptWorkspace;

  const secretToken = await context.secrets.get(SECRET_SESSION_TOKEN_KEY);
  const persistedToken =
    typeof persisted.sessionToken === 'string' ? persisted.sessionToken : '';
  const fallbackSettingToken = normalizeConfigString(
    config.get<string>('sessionToken', ''),
    '',
  );
  const sessionToken = resolvePersistedVsCodeSessionToken({
    secretToken,
    persistedToken,
    settingToken: fallbackSettingToken,
  });
  const codeAgentPromptDefault = await fetchCodeAgentPromptDefault({
    apiBaseUrl,
    sessionToken,
  });
  const promptProfile = resolveCodeAgentPromptProfile({
    workspaceOverride: codeAgentPromptWorkspace,
    serverOverride: codeAgentPromptGlobal,
    defaultPrompt: codeAgentPromptDefault,
  });
  const projectWorkspaceMapping = await getOrSyncProjectWorkspaceMapping({
    context,
    apiBaseUrl,
    sessionToken,
    projectFingerprint,
  });

  return {
    apiBaseUrl,
    appBaseUrl,
    wsBaseUrl,
    sessionToken,
    codexSignInUrl: defaultConfig.codexSignInUrl,
    codeAgentPromptDefault,
    codeAgentPromptGlobal,
    codeAgentPromptWorkspace,
    codeAgentPromptEffective: promptProfile.effectivePrompt,
    codeAgentPromptSource: promptProfile.source,
    instructionIncludePatterns,
    workspaceScopeKey,
    workspaceScopeLabel,
    projectFingerprint,
    workspaceScopeWorkspaceId: projectWorkspaceMapping?.mappedWorkspaceId ?? '',
    workspaceScopeLastWorkspaceId: projectWorkspaceMapping?.lastWorkspaceId ?? '',
    codeWorkspaces: projectWorkspaceMapping?.codeWorkspaces ?? [],
  };
};

const saveRuntimeConfigPatch = async (
  context: vscode.ExtensionContext,
  payload: RuntimeConfigPatchPayload,
): Promise<TopAiRuntimeConfig> => {
  const current = context.globalState.get<RuntimeConfigPatchPayload>(
    STATE_KEY_RUNTIME_CONFIG,
    {},
  );
  const next: RuntimeConfigPatchPayload = {
    ...current,
  };

  if (typeof payload.apiBaseUrl === 'string') {
    next.apiBaseUrl = payload.apiBaseUrl.trim();
  }
  if (typeof payload.appBaseUrl === 'string') {
    next.appBaseUrl = payload.appBaseUrl.trim();
  }
  if (typeof payload.wsBaseUrl === 'string') {
    next.wsBaseUrl = payload.wsBaseUrl.trim();
  }
  if (typeof payload.codeAgentPromptGlobal === 'string') {
    next.codeAgentPromptGlobal = payload.codeAgentPromptGlobal;
  }
  if (Array.isArray(payload.instructionIncludePatterns)) {
    next.instructionIncludePatterns = normalizeInstructionIncludePatterns(
      payload.instructionIncludePatterns,
    );
  }

  if (typeof payload.sessionToken === 'string') {
    const token = payload.sessionToken.trim();
    next.sessionToken = token;
    if (token.length > 0) {
      await context.secrets.store(SECRET_SESSION_TOKEN_KEY, token);
    } else {
      await context.secrets.delete(SECRET_SESSION_TOKEN_KEY);
    }
  }

  if (typeof payload.codeAgentPromptWorkspace === 'string') {
    const { workspaceScopeKey } = await resolveWorkspaceScope();
    if (workspaceScopeKey) {
      const map = readWorkspacePromptOverrideMap(context);
      const nextValue = payload.codeAgentPromptWorkspace;
      if (nextValue.trim().length > 0) {
        map[workspaceScopeKey] = nextValue;
      } else {
        delete map[workspaceScopeKey];
      }
      await context.globalState.update(STATE_KEY_WORKSPACE_PROMPT_OVERRIDES, map);
    }
  }

  await context.globalState.update(STATE_KEY_RUNTIME_CONFIG, next);
  return readRuntimeConfig(context);
};

const testApiConnectivity = async (
  apiBaseUrl: string,
  sessionToken: string,
): Promise<{
  ok: boolean;
  status?: number;
  statusText?: string;
  error?: string;
}> => {
  const normalizedBase = apiBaseUrl.replace(/\/$/, '');
  const healthUrl = `${normalizedBase}/health`;

  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: {
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
    });

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      error: response.ok
        ? undefined
        : `HTTP ${response.status}: ${response.statusText}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const shouldInjectVsCodeCodeAgentPayload = (
  method: string,
  pathname: string,
): boolean => {
  if (method !== 'POST' && method !== 'PATCH') return false;
  return /\/api\/v1\/chat\/messages(?:\/[^/]+\/(?:retry|tool-results))?$/.test(
    pathname,
  );
};

const listVsCodeInstructionFiles = async (
  runtimeConfig: TopAiRuntimeConfig,
): Promise<VsCodeInstructionFile[]> => {
  const patterns = buildInstructionDiscoveryPatterns(
    runtimeConfig.instructionIncludePatterns,
  );
  if (patterns.length === 0) return [];

  const decoder = new TextDecoder();
  const files: VsCodeInstructionFile[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    if (files.length >= INSTRUCTION_DISCOVERY_MAX_FILES) break;
    const uris = await vscode.workspace.findFiles(
      pattern,
      INSTRUCTION_DISCOVERY_EXCLUDE_GLOB,
      INSTRUCTION_DISCOVERY_MAX_FILES,
    );
    for (const uri of uris) {
      if (files.length >= INSTRUCTION_DISCOVERY_MAX_FILES) break;
      const relativePath = vscode.workspace.asRelativePath(uri, false);
      if (!relativePath || seen.has(relativePath)) continue;
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const content = decoder.decode(bytes).trim();
        if (!content) continue;
        files.push({
          path: relativePath,
          content: content.slice(0, INSTRUCTION_DISCOVERY_MAX_FILE_CHARS),
        });
        seen.add(relativePath);
      } catch {
        // ignore unreadable files and continue
      }
    }
  }
  return files;
};

const buildVsCodeSystemContext = async (
  runtimeConfig: TopAiRuntimeConfig,
): Promise<VsCodeCodeAgentSystemContext> => {
  const workingDirectory = runtimeConfig.workspaceScopeKey.trim();
  const branch = workingDirectory ? await readGitBranch(workingDirectory) : null;
  const isGitRepo = workingDirectory
    ? Boolean(await resolveGitDirPath(workingDirectory))
    : false;
  const timezone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
      return '';
    }
  })();
  const shell = (process.env.SHELL || process.env.ComSpec || '').trim();
  return {
    ...(workingDirectory ? { workingDirectory } : {}),
    isGitRepo,
    ...(branch ? { gitBranch: branch } : {}),
    platform: process.platform,
    osVersion: `${os.type()} ${os.release()}`,
    ...(shell ? { shell } : {}),
    clientDateIso: new Date().toISOString(),
    ...(timezone ? { clientTimezone: timezone } : {}),
  };
};

const injectVsCodeCodeAgentIntoBody = async (
  runtimeConfig: TopAiRuntimeConfig,
  targetUrl: URL,
  method: string,
  bodyText: string | undefined,
): Promise<string | undefined> => {
  if (!shouldInjectVsCodeCodeAgentPayload(method, targetUrl.pathname)) {
    return bodyText;
  }
  const sourceBody = typeof bodyText === 'string' && bodyText.trim() ? bodyText : '{}';
  let parsed: Record<string, unknown>;
  try {
    const raw = JSON.parse(sourceBody);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return bodyText;
    }
    parsed = raw as Record<string, unknown>;
  } catch {
    return bodyText;
  }

  const instructionFiles = await listVsCodeInstructionFiles(runtimeConfig);
  const systemContext = await buildVsCodeSystemContext(runtimeConfig);
  const payload: VsCodeCodeAgentPayload = {
    source: 'vscode',
    ...(runtimeConfig.workspaceScopeKey
      ? { workspaceKey: runtimeConfig.workspaceScopeKey }
      : {}),
    ...(runtimeConfig.workspaceScopeLabel
      ? { workspaceLabel: runtimeConfig.workspaceScopeLabel }
      : {}),
    ...(runtimeConfig.codeAgentPromptGlobal.trim()
      ? { promptGlobalOverride: runtimeConfig.codeAgentPromptGlobal }
      : {}),
    ...(runtimeConfig.codeAgentPromptWorkspace.trim()
      ? { promptWorkspaceOverride: runtimeConfig.codeAgentPromptWorkspace }
      : {}),
    instructionIncludePatterns: runtimeConfig.instructionIncludePatterns,
    instructionFiles,
    systemContext,
  };
  parsed.vscodeCodeAgent = payload;
  return JSON.stringify(parsed);
};

const shouldAppendWorkspaceScopeQuery = (pathname: string): boolean => {
  if (!pathname.startsWith('/api/v1/')) return false;
  if (pathname.startsWith('/api/v1/auth/')) return false;
  if (pathname === '/api/v1/workspaces' || pathname.startsWith('/api/v1/workspaces/')) {
    return false;
  }
  if (
    pathname === '/api/v1/vscode-extension/workspace-mapping' ||
    pathname.startsWith('/api/v1/vscode-extension/workspace-mapping/')
  ) {
    return false;
  }
  return true;
};

const performRuntimeHttpRequest = async (
  runtimeConfig: TopAiRuntimeConfig,
  payload: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    bodyText?: string;
  },
): Promise<RuntimeHttpRequestResult> => {
  const url = typeof payload.url === 'string' ? payload.url.trim() : '';
  if (!url) {
    throw new Error('runtime.http.request requires a non-empty url.');
  }

  const method = typeof payload.method === 'string' && payload.method.trim()
    ? payload.method.trim().toUpperCase()
    : 'GET';
  const targetUrl = new URL(url);
  const apiBaseOrigin = (() => {
    try {
      return new URL(runtimeConfig.apiBaseUrl).origin;
    } catch {
      return '';
    }
  })();

  if (apiBaseOrigin && targetUrl.origin !== apiBaseOrigin) {
    throw new Error('runtime.http.request rejects cross-origin targets.');
  }
  if (
    runtimeConfig.workspaceScopeWorkspaceId.trim().length > 0 &&
    shouldAppendWorkspaceScopeQuery(targetUrl.pathname) &&
    !targetUrl.searchParams.has('workspace_id')
  ) {
    targetUrl.searchParams.set(
      'workspace_id',
      runtimeConfig.workspaceScopeWorkspaceId.trim(),
    );
  }

  const normalizedHeaders = new Headers(payload.headers ?? {});
  // Always canonicalize Authorization from runtime config to avoid duplicate/malformed JWT headers.
  normalizedHeaders.delete('authorization');
  if (runtimeConfig.sessionToken.trim()) {
    normalizedHeaders.set(
      'authorization',
      `Bearer ${runtimeConfig.sessionToken.trim()}`,
    );
  }

  const nextBodyText = await injectVsCodeCodeAgentIntoBody(
    runtimeConfig,
    targetUrl,
    method,
    payload.bodyText,
  );
  if (
    typeof nextBodyText === 'string' &&
    method !== 'GET' &&
    method !== 'HEAD' &&
    !normalizedHeaders.has('content-type')
  ) {
    normalizedHeaders.set('content-type', 'application/json');
  }

  const response = await fetch(targetUrl.toString(), {
    method,
    headers: normalizedHeaders,
    body:
      typeof nextBodyText === 'string' && method !== 'GET' && method !== 'HEAD'
        ? nextBodyText
        : undefined,
  });

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers,
    bodyText: await response.text(),
  };
};

const validateTokenSession = async (
  apiBaseUrl: string,
  sessionToken: string,
): Promise<{
  connected: boolean;
  reason: string;
  user?: {
    id: string;
    email: string | null;
    displayName: string | null;
    role: string;
  } | null;
}> => {
  if (!sessionToken.trim()) {
    return {
      connected: false,
      reason: 'TOKEN_REQUIRED',
      user: null,
    };
  }

  const normalizedBase = apiBaseUrl.replace(/\/$/, '');
  const sessionUrl = `${normalizedBase}/auth/session`;

  try {
    const response = await fetch(sessionUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
    });

    if (!response.ok) {
      return {
        connected: false,
        reason: `HTTP_${response.status}`,
        user: null,
      };
    }

    const payload = (await response.json()) as {
      userId?: string;
      email?: string | null;
      displayName?: string | null;
      role?: string;
    };

    if (!payload?.userId) {
      return {
        connected: false,
        reason: 'INVALID_SESSION_PAYLOAD',
        user: null,
      };
    }

    return {
      connected: true,
      reason: 'connected',
      user: {
        id: payload.userId,
        email: payload.email ?? null,
        displayName: payload.displayName ?? null,
        role: payload.role ?? 'editor',
      },
    };
  } catch (error) {
    return {
      connected: false,
      reason: error instanceof Error ? error.message : String(error),
      user: null,
    };
  }
};

const createWebviewHtml = (
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  config: TopAiRuntimeConfig,
): string => {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview-entry.js'),
  );
  const nonce = `${Date.now()}${Math.random().toString(36).slice(2)}`;
  const runtimeConfigJson = JSON.stringify(config).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource} https: http: wss: ws:;" />
    <title>Top AI Ideas</title>
  </head>
  <body style="margin: 0; padding: 0; overflow: hidden;">
    <div id="topai-vscode-root" style="height: 100vh;"></div>
    <script nonce="${nonce}">
      window.__TOPAI_VSCODE_RUNTIME__ = ${runtimeConfigJson};
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
};

class TopAiChatViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;
  private revealRequested = false;
  private readonly streamProxyControllers = new Map<string, AbortController>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly runtimeHandler: ReturnType<typeof createTopAiVsCodeRequestHandler>,
    private readonly localToolsRuntime: ReturnType<typeof createVsCodeLocalToolsRuntime>,
  ) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.stopAllStreamProxies();
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };

    const runtimeConfig = await readRuntimeConfig(this.context);
    webviewView.webview.html = createWebviewHtml(
      webviewView.webview,
      this.context.extensionUri,
      runtimeConfig,
    );

    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleWebviewMessage(message);
    });

    if (this.revealRequested) {
      this.revealRequested = false;
      const maybeShow = (webviewView as vscode.WebviewView & {
        show?: (preserveFocus?: boolean) => void;
      }).show;
      maybeShow?.call(webviewView, true);
    }
  }

  async reveal(): Promise<void> {
    this.revealRequested = true;
    await vscode.commands.executeCommand(
      `workbench.view.extension.${VIEW_CONTAINER_ID}`,
    );
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);

    if (this.view) {
      const maybeShow = (this.view as vscode.WebviewView & {
        show?: (preserveFocus?: boolean) => void;
      }).show;
      maybeShow?.call(this.view, true);
    }
  }

  async refresh(): Promise<void> {
    if (!this.view) return;
    this.stopAllStreamProxies();
    const runtimeConfig = await readRuntimeConfig(this.context);
    this.view.webview.html = createWebviewHtml(
      this.view.webview,
      this.context.extensionUri,
      runtimeConfig,
    );
  }

  private emitHostEvent(command: string, payload: unknown): void {
    this.view?.webview.postMessage({
      source: 'topai-vscode-host',
      type: 'event',
      command,
      payload,
    });
  }

  private emitStreamProxyMessage(
    portId: string,
    message: VsCodeSseProxyMessage,
  ): void {
    this.emitHostEvent('runtime.stream.proxy.event', {
      portId,
      message,
    });
  }

  private stopStreamProxy(portId: string): void {
    const controller = this.streamProxyControllers.get(portId);
    if (!controller) return;
    this.streamProxyControllers.delete(portId);
    controller.abort();
  }

  private stopAllStreamProxies(): void {
    for (const controller of this.streamProxyControllers.values()) {
      controller.abort();
    }
    this.streamProxyControllers.clear();
  }

  private async startStreamProxy(input: {
    portId: string;
    baseUrl: string;
    workspaceId: string | null;
    streamIds: string[];
  }): Promise<void> {
    const runtimeConfig = await readRuntimeConfig(this.context);
    const baseUrl = input.baseUrl.trim();
    if (!baseUrl) {
      throw new Error('runtime.stream.proxy.start requires baseUrl.');
    }
    const requestedOrigin = new URL(baseUrl).origin;
    const apiOrigin = new URL(runtimeConfig.apiBaseUrl).origin;
    if (requestedOrigin !== apiOrigin) {
      throw new Error('runtime.stream.proxy.start rejects cross-origin targets.');
    }

    const controller = new AbortController();
    this.stopStreamProxy(input.portId);
    this.streamProxyControllers.set(input.portId, controller);

    try {
      await runVsCodeSseProxy(
        {
          baseUrl,
          workspaceId: input.workspaceId,
          streamIds: input.streamIds,
          authToken: runtimeConfig.sessionToken,
        },
        {
          signal: controller.signal,
          emit: (message) => {
            this.emitStreamProxyMessage(input.portId, message);
          },
        },
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        const reason = error instanceof Error ? error.message : String(error);
        this.emitStreamProxyMessage(input.portId, {
          type: 'sse_error',
          error: reason,
        });
      }
    } finally {
      if (this.streamProxyControllers.get(input.portId) === controller) {
        this.streamProxyControllers.delete(input.portId);
      }
      this.emitStreamProxyMessage(input.portId, {
        type: 'sse_closed',
      });
    }
  }

  private async handleWebviewMessage(rawMessage: unknown): Promise<void> {
    if (!this.view || !rawMessage || typeof rawMessage !== 'object') return;

    const payload = rawMessage as Record<string, unknown>;
    if (payload.source !== 'topai-vscode-webview') return;
    if (payload.type !== 'request') return;

    const requestId =
      typeof payload.requestId === 'string' ? payload.requestId : '';
    const command =
      typeof payload.command === 'string' ? payload.command.trim() : '';
    if (!requestId || !command) return;

    const respond = (ok: boolean, resultPayload?: unknown, error?: string): void => {
      this.view?.webview.postMessage({
        source: 'topai-vscode-host',
        type: 'response',
        command,
        requestId,
        ok,
        payload: resultPayload,
        error,
      });
    };

    try {
      if (command === 'runtime.config.get') {
        respond(true, await readRuntimeConfig(this.context));
        return;
      }

      if (command === 'runtime.config.set') {
        const patch =
          payload.payload && typeof payload.payload === 'object'
            ? (payload.payload as RuntimeConfigPatchPayload)
            : {};
        const updatedConfig = await saveRuntimeConfigPatch(this.context, patch);
        respond(true, updatedConfig);
        return;
      }

      if (command === 'runtime.config.test') {
        const runtimeConfig = await readRuntimeConfig(this.context);
        const requestPayload =
          payload.payload && typeof payload.payload === 'object'
            ? (payload.payload as { apiBaseUrl?: unknown })
            : {};
        const targetApiBaseUrl =
          typeof requestPayload.apiBaseUrl === 'string' &&
          requestPayload.apiBaseUrl.trim().length > 0
            ? requestPayload.apiBaseUrl.trim()
            : runtimeConfig.apiBaseUrl;

        const result = await testApiConnectivity(
          targetApiBaseUrl,
          runtimeConfig.sessionToken,
        );
        respond(true, result);
        return;
      }

      if (command === 'runtime.workspace.mapping.get') {
        const runtimeConfig = await readRuntimeConfig(this.context);
        const requestPayload =
          payload.payload && typeof payload.payload === 'object'
            ? (payload.payload as { projectFingerprint?: unknown })
            : {};
        const projectFingerprint =
          typeof requestPayload.projectFingerprint === 'string' &&
          requestPayload.projectFingerprint.trim().length > 0
            ? requestPayload.projectFingerprint.trim()
            : runtimeConfig.projectFingerprint.trim();
        if (!projectFingerprint) {
          respond(false, undefined, 'Project scope is not detected yet.');
          return;
        }
        if (!runtimeConfig.sessionToken.trim()) {
          respond(true, runtimeConfig);
          return;
        }
        const record = await fetchProjectWorkspaceMappingRecord({
          apiBaseUrl: runtimeConfig.apiBaseUrl,
          sessionToken: runtimeConfig.sessionToken,
          projectFingerprint,
        });
        if (record) {
          await upsertProjectWorkspaceMappingRecord(this.context, record);
        }
        respond(true, await readRuntimeConfig(this.context));
        return;
      }

      if (command === 'runtime.workspace.mapping.set') {
        const runtimeConfig = await readRuntimeConfig(this.context);
        const requestPayload =
          payload.payload && typeof payload.payload === 'object'
            ? (payload.payload as { projectFingerprint?: unknown; workspaceId?: unknown })
            : {};
        const projectFingerprint =
          typeof requestPayload.projectFingerprint === 'string' &&
          requestPayload.projectFingerprint.trim().length > 0
            ? requestPayload.projectFingerprint.trim()
            : runtimeConfig.projectFingerprint.trim();
        const workspaceId =
          typeof requestPayload.workspaceId === 'string'
            ? requestPayload.workspaceId.trim()
            : '';
        if (!projectFingerprint) {
          respond(false, undefined, 'Project scope is not detected yet.');
          return;
        }
        if (!workspaceId) {
          respond(false, undefined, 'workspaceId is required.');
          return;
        }
        if (!runtimeConfig.sessionToken.trim()) {
          respond(false, undefined, 'Extension token is required.');
          return;
        }
        const record = await putProjectWorkspaceMappingRecord({
          apiBaseUrl: runtimeConfig.apiBaseUrl,
          sessionToken: runtimeConfig.sessionToken,
          projectFingerprint,
          workspaceId,
        });
        if (!record) {
          respond(false, undefined, 'Unable to map project to workspace.');
          return;
        }
        await upsertProjectWorkspaceMappingRecord(this.context, record);
        respond(true, await readRuntimeConfig(this.context));
        return;
      }

      if (command === 'runtime.workspace.mapping.create') {
        const runtimeConfig = await readRuntimeConfig(this.context);
        const workspaceScope = await resolveWorkspaceScope();
        const requestPayload =
          payload.payload && typeof payload.payload === 'object'
            ? (payload.payload as {
                projectFingerprint?: unknown;
                name?: unknown;
                repositoryName?: unknown;
              })
            : {};
        const projectFingerprint =
          typeof requestPayload.projectFingerprint === 'string' &&
          requestPayload.projectFingerprint.trim().length > 0
            ? requestPayload.projectFingerprint.trim()
            : runtimeConfig.projectFingerprint.trim();
        const name =
          typeof requestPayload.name === 'string' ? requestPayload.name.trim() : '';
        const repositoryName =
          typeof requestPayload.repositoryName === 'string'
            ? requestPayload.repositoryName.trim()
            : workspaceScope.repositoryName.trim();
        if (!projectFingerprint) {
          respond(false, undefined, 'Project scope is not detected yet.');
          return;
        }
        if (!runtimeConfig.sessionToken.trim()) {
          respond(false, undefined, 'Extension token is required.');
          return;
        }
        const record = await createProjectCodeWorkspaceMappingRecord({
          apiBaseUrl: runtimeConfig.apiBaseUrl,
          sessionToken: runtimeConfig.sessionToken,
          projectFingerprint,
          ...(name ? { name } : {}),
          ...(repositoryName ? { repositoryName } : {}),
        });
        if (!record) {
          respond(false, undefined, 'Unable to create code workspace mapping.');
          return;
        }
        await upsertProjectWorkspaceMappingRecord(this.context, record);
        respond(true, await readRuntimeConfig(this.context));
        return;
      }

      if (command === 'runtime.workspace.mapping.not_now') {
        const runtimeConfig = await readRuntimeConfig(this.context);
        const requestPayload =
          payload.payload && typeof payload.payload === 'object'
            ? (payload.payload as { projectFingerprint?: unknown })
            : {};
        const projectFingerprint =
          typeof requestPayload.projectFingerprint === 'string' &&
          requestPayload.projectFingerprint.trim().length > 0
            ? requestPayload.projectFingerprint.trim()
            : runtimeConfig.projectFingerprint.trim();
        if (!projectFingerprint) {
          respond(false, undefined, 'Project scope is not detected yet.');
          return;
        }
        if (!runtimeConfig.sessionToken.trim()) {
          respond(false, undefined, 'Extension token is required.');
          return;
        }
        const record = await notNowProjectWorkspaceMappingRecord({
          apiBaseUrl: runtimeConfig.apiBaseUrl,
          sessionToken: runtimeConfig.sessionToken,
          projectFingerprint,
        });
        if (!record) {
          respond(false, undefined, 'Unable to apply workspace fallback.');
          return;
        }
        await upsertProjectWorkspaceMappingRecord(this.context, record);
        respond(true, await readRuntimeConfig(this.context));
        return;
      }

      if (command === 'runtime.auth.validate') {
        const runtimeConfig = await readRuntimeConfig(this.context);
        const result = await validateTokenSession(
          runtimeConfig.apiBaseUrl,
          runtimeConfig.sessionToken,
        );
        respond(true, result);
        return;
      }

      if (command === 'runtime.stream.proxy.start') {
        const requestPayload =
          payload.payload && typeof payload.payload === 'object'
            ? (payload.payload as {
                portId?: unknown;
                baseUrl?: unknown;
                workspaceId?: unknown;
                streamIds?: unknown;
              })
            : {};
        const portId =
          typeof requestPayload.portId === 'string'
            ? requestPayload.portId.trim()
            : '';
        const baseUrl =
          typeof requestPayload.baseUrl === 'string'
            ? requestPayload.baseUrl.trim()
            : '';
        const workspaceId =
          typeof requestPayload.workspaceId === 'string' &&
          requestPayload.workspaceId.trim().length > 0
            ? requestPayload.workspaceId.trim()
            : null;
        const streamIds = Array.isArray(requestPayload.streamIds)
          ? requestPayload.streamIds
              .map((entry) =>
                typeof entry === 'string' ? entry.trim() : '',
              )
              .filter((entry) => entry.length > 0)
              .slice(0, 200)
          : [];
        if (!portId) {
          respond(false, undefined, 'runtime.stream.proxy.start requires portId.');
          return;
        }
        void this.startStreamProxy({
          portId,
          baseUrl,
          workspaceId,
          streamIds,
        });
        respond(true, { started: true });
        return;
      }

      if (command === 'runtime.stream.proxy.stop') {
        const requestPayload =
          payload.payload && typeof payload.payload === 'object'
            ? (payload.payload as { portId?: unknown })
            : {};
        const portId =
          typeof requestPayload.portId === 'string'
            ? requestPayload.portId.trim()
            : '';
        if (!portId) {
          respond(false, undefined, 'runtime.stream.proxy.stop requires portId.');
          return;
        }
        this.stopStreamProxy(portId);
        respond(true, { stopped: true });
        return;
      }

      if (command === 'runtime.local_tools.execute') {
        const result = await this.localToolsRuntime.execute(payload.payload);
        respond(true, result);
        return;
      }

      if (command === 'runtime.local_tools.permission_decide') {
        const result = await this.localToolsRuntime.decide(payload.payload);
        respond(true, result);
        return;
      }

      if (command === 'runtime.local_tools.permissions.list') {
        const result = await this.localToolsRuntime.listPolicies();
        respond(true, result);
        return;
      }

      if (command === 'runtime.local_tools.permissions.upsert') {
        const result = await this.localToolsRuntime.upsertPolicy(payload.payload);
        respond(true, result);
        return;
      }

      if (command === 'runtime.local_tools.permissions.delete') {
        const result = await this.localToolsRuntime.deletePolicy(payload.payload);
        respond(true, result);
        return;
      }

      const result = await this.runtimeHandler(
        command as TopAiVsCodeCommand,
        payload.payload,
      );
      respond(true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respond(false, undefined, message);
    }
  }
}

export const activate = (context: vscode.ExtensionContext): void => {
  const localToolsRuntime = createVsCodeLocalToolsRuntime(context, {
    getWorkspaceRoot: () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      return folder?.uri?.fsPath ?? null;
    },
  });
  const runtimeHandler = createTopAiVsCodeRequestHandler({
    getRuntimeConfig: async () => readRuntimeConfig(context),
    validateRuntimeAuth: async () => {
      const runtimeConfig = await readRuntimeConfig(context);
      return validateTokenSession(
        runtimeConfig.apiBaseUrl,
        runtimeConfig.sessionToken,
      );
    },
    performRuntimeHttpRequest: async (payload) => {
      const runtimeConfig = await readRuntimeConfig(context);
      return performRuntimeHttpRequest(runtimeConfig, payload);
    },
  });

  const provider = new TopAiChatViewProvider(
    context,
    runtimeHandler,
    localToolsRuntime,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_OPEN_PANEL, () => {
      void provider.reveal();
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('topai')) return;
      void provider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void provider.refresh();
    }),
  );
};

export const deactivate = (): void => {
  // no-op
};
