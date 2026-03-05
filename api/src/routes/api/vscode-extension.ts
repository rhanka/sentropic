import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../../db/client';
import { workspaceMemberships, workspaces } from '../../db/schema';
import { sql } from 'drizzle-orm';
import { env } from '../../config/env';
import { getUserWorkspaces } from '../../services/workspace-access';
import { createId } from '../../utils/id';
import { requireEditor } from '../../middleware/rbac';

const DEFAULT_EXTENSION_VERSION = '0.1.0';
const DEFAULT_EXTENSION_SOURCE = 'ui/vscode-ext';
const DEFAULT_EXTENSION_VSIX_PATH = '/vscode-extension/top-ai-ideas-vscode-extension.vsix';
const VSCODE_PROJECT_WORKSPACE_STATE_KEY = 'vscode_project_workspace_state_v1';

const readConfig = () => {
  const downloadUrl = (process.env.VSCODE_EXTENSION_DOWNLOAD_URL ?? env.VSCODE_EXTENSION_DOWNLOAD_URL ?? '').trim();
  const version = (process.env.VSCODE_EXTENSION_VERSION ?? env.VSCODE_EXTENSION_VERSION ?? '').trim();
  const source = (process.env.VSCODE_EXTENSION_SOURCE ?? env.VSCODE_EXTENSION_SOURCE ?? '').trim();

  return {
    downloadUrl,
    version: version || DEFAULT_EXTENSION_VERSION,
    source: source || DEFAULT_EXTENSION_SOURCE,
  };
};

const normalizeHttpUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const buildFallbackDownloadUrlFromOrigin = (originHeader: string | undefined): string | null => {
  const origin = (originHeader ?? '').trim();
  if (!origin) return null;

  const normalizedOrigin = normalizeHttpUrl(origin);
  if (!normalizedOrigin) return null;

  return new URL(DEFAULT_EXTENSION_VSIX_PATH, normalizedOrigin).toString();
};

export const vscodeExtensionRouter = new Hono();

type CodeWorkspace = {
  id: string;
  name: string;
  role: 'viewer' | 'commenter' | 'editor' | 'admin';
};

type VsCodeProjectWorkspaceState = {
  version: 1;
  mappings: Record<string, string>;
  codeWorkspaceIds: string[];
  lastWorkspaceId: string | null;
  updatedAt: string;
};

const defaultWorkspaceState = (): VsCodeProjectWorkspaceState => ({
  version: 1,
  mappings: {},
  codeWorkspaceIds: [],
  lastWorkspaceId: null,
  updatedAt: new Date().toISOString(),
});

const projectFingerprintSchema = z
  .string()
  .trim()
  .min(8)
  .max(256)
  .regex(/^[a-z0-9._:-]+$/i);

const mappingUpdateSchema = z.object({
  projectFingerprint: projectFingerprintSchema,
  workspaceId: z.string().trim().min(1),
});

const mappingCreateCodeWorkspaceSchema = z.object({
  projectFingerprint: projectFingerprintSchema,
  name: z.string().trim().min(1).max(128).optional(),
  repositoryName: z.string().trim().min(1).max(128).optional(),
});

const mappingNotNowSchema = z.object({
  projectFingerprint: projectFingerprintSchema,
});

const parseWorkspaceState = (
  raw: string | null | undefined,
): VsCodeProjectWorkspaceState => {
  if (!raw) return defaultWorkspaceState();
  try {
    const parsed = JSON.parse(raw) as Partial<VsCodeProjectWorkspaceState> | null;
    if (!parsed || typeof parsed !== 'object') return defaultWorkspaceState();
    const mappingsRaw =
      parsed.mappings && typeof parsed.mappings === 'object'
        ? (parsed.mappings as Record<string, unknown>)
        : {};
    const mappings: Record<string, string> = {};
    for (const [fingerprint, workspaceId] of Object.entries(mappingsRaw)) {
      if (
        typeof fingerprint !== 'string' ||
        typeof workspaceId !== 'string' ||
        !projectFingerprintSchema.safeParse(fingerprint).success ||
        !workspaceId.trim()
      ) {
        continue;
      }
      mappings[fingerprint] = workspaceId.trim();
    }
    const codeWorkspaceIds = Array.isArray(parsed.codeWorkspaceIds)
      ? parsed.codeWorkspaceIds
          .filter((id): id is string => typeof id === 'string')
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
      : [];
    const dedupedCodeWorkspaceIds: string[] = [];
    for (const id of codeWorkspaceIds) {
      if (!dedupedCodeWorkspaceIds.includes(id)) dedupedCodeWorkspaceIds.push(id);
    }
    return {
      version: 1,
      mappings,
      codeWorkspaceIds: dedupedCodeWorkspaceIds,
      lastWorkspaceId:
        typeof parsed.lastWorkspaceId === 'string' && parsed.lastWorkspaceId.trim().length > 0
          ? parsed.lastWorkspaceId.trim()
          : null,
      updatedAt:
        typeof parsed.updatedAt === 'string' && parsed.updatedAt.trim().length > 0
          ? parsed.updatedAt
          : new Date().toISOString(),
    };
  } catch {
    return defaultWorkspaceState();
  }
};

const normalizeWorkspaceNameCandidate = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().slice(0, 128);
  return normalized.length > 0 ? normalized : null;
};

const readWorkspaceState = async (
  userId: string,
): Promise<VsCodeProjectWorkspaceState> => {
  const row = (await db.get(
    sql`SELECT value FROM settings WHERE key = ${VSCODE_PROJECT_WORKSPACE_STATE_KEY} AND user_id = ${userId}`,
  )) as { value?: string | null } | undefined;
  return parseWorkspaceState(row?.value ?? null);
};

const writeWorkspaceState = async (
  userId: string,
  state: VsCodeProjectWorkspaceState,
): Promise<void> => {
  await db.run(sql`
    INSERT INTO settings (key, user_id, value, description, updated_at)
    VALUES (${VSCODE_PROJECT_WORKSPACE_STATE_KEY}, ${userId}, ${JSON.stringify(state)}, 'VSCode project/workspace mapping state', ${new Date().toISOString()})
    ON CONFLICT (user_id, key) WHERE user_id IS NOT NULL
    DO UPDATE SET
      value = EXCLUDED.value,
      description = EXCLUDED.description,
      updated_at = EXCLUDED.updated_at
  `);
};

const sanitizeWorkspaceState = (
  state: VsCodeProjectWorkspaceState,
  workspaces: CodeWorkspace[],
): { state: VsCodeProjectWorkspaceState; changed: boolean } => {
  const allowedIds = new Set(workspaces.map((workspace) => workspace.id));
  let changed = false;

  const normalizedCodeWorkspaceIds = state.codeWorkspaceIds.filter((id) => {
    const keep = allowedIds.has(id);
    if (!keep) changed = true;
    return keep;
  });

  const codeIdSet = new Set(normalizedCodeWorkspaceIds);
  const normalizedMappings: Record<string, string> = {};
  for (const [fingerprint, workspaceId] of Object.entries(state.mappings)) {
    if (!allowedIds.has(workspaceId) || !codeIdSet.has(workspaceId)) {
      changed = true;
      continue;
    }
    normalizedMappings[fingerprint] = workspaceId;
  }

  let normalizedLastWorkspaceId: string | null = state.lastWorkspaceId;
  if (
    normalizedLastWorkspaceId &&
    (!allowedIds.has(normalizedLastWorkspaceId) || !codeIdSet.has(normalizedLastWorkspaceId))
  ) {
    changed = true;
    normalizedLastWorkspaceId = null;
  }
  if (!normalizedLastWorkspaceId && normalizedCodeWorkspaceIds.length > 0) {
    changed = true;
    normalizedLastWorkspaceId = normalizedCodeWorkspaceIds[0];
  }

  if (!changed) return { state, changed: false };

  return {
    changed: true,
    state: {
      version: 1,
      mappings: normalizedMappings,
      codeWorkspaceIds: normalizedCodeWorkspaceIds,
      lastWorkspaceId: normalizedLastWorkspaceId,
      updatedAt: new Date().toISOString(),
    },
  };
};

const buildWorkspaceMappingSnapshot = (input: {
  projectFingerprint: string;
  state: VsCodeProjectWorkspaceState;
  workspaces: CodeWorkspace[];
}) => {
  const codeWorkspaceSet = new Set(input.state.codeWorkspaceIds);
  const codeWorkspaces = input.workspaces.filter((workspace) =>
    codeWorkspaceSet.has(workspace.id),
  );
  const mappedWorkspaceId =
    input.state.mappings[input.projectFingerprint] ?? null;
  const mappedWorkspace = mappedWorkspaceId
    ? codeWorkspaces.find((workspace) => workspace.id === mappedWorkspaceId) ?? null
    : null;
  return {
    projectFingerprint: input.projectFingerprint,
    mappedWorkspaceId: mappedWorkspace?.id ?? null,
    mappedWorkspaceName: mappedWorkspace?.name ?? null,
    lastWorkspaceId: input.state.lastWorkspaceId,
    codeWorkspaces,
  };
};

const listCodeWorkspacesForUser = async (
  userId: string,
): Promise<CodeWorkspace[]> => {
  const workspaceRows = await getUserWorkspaces(userId);
  return workspaceRows.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    role: workspace.role,
  }));
};

vscodeExtensionRouter.get('/download', async (c) => {
  const config = readConfig();

  let resolvedDownloadUrl: string | null = null;

  if (config.downloadUrl) {
    resolvedDownloadUrl = normalizeHttpUrl(config.downloadUrl);
    if (!resolvedDownloadUrl) {
      return c.json(
        {
          message:
            'VSCode extension download is unavailable: VSCODE_EXTENSION_DOWNLOAD_URL must be a valid http(s) URL, then restart the API.',
        },
        503
      );
    }
  } else {
    resolvedDownloadUrl = buildFallbackDownloadUrlFromOrigin(c.req.header('origin'));
    if (!resolvedDownloadUrl) {
      return c.json(
        {
          message:
            'VSCode extension download is unavailable: set VSCODE_EXTENSION_DOWNLOAD_URL in the API environment and restart the API.',
        },
        503
      );
    }
  }

  return c.json({
    version: config.version,
    source: config.source,
    downloadUrl: resolvedDownloadUrl,
  });
});

vscodeExtensionRouter.get('/workspace-mapping', async (c) => {
  const user = c.get('user') as { userId?: string } | undefined;
  if (!user?.userId) {
    return c.json({ message: 'Authentication required' }, 401);
  }

  const projectFingerprintRaw = c.req.query('project_fingerprint') ?? '';
  const projectFingerprint = projectFingerprintRaw.trim();
  if (!projectFingerprintSchema.safeParse(projectFingerprint).success) {
    return c.json({ message: 'Invalid project_fingerprint query parameter.' }, 400);
  }

  const workspaces = await listCodeWorkspacesForUser(user.userId);
  const state = await readWorkspaceState(user.userId);
  const sanitized = sanitizeWorkspaceState(state, workspaces);
  if (sanitized.changed) {
    await writeWorkspaceState(user.userId, sanitized.state);
  }

  return c.json(
    buildWorkspaceMappingSnapshot({
      projectFingerprint,
      state: sanitized.state,
      workspaces,
    }),
  );
});

vscodeExtensionRouter.put('/workspace-mapping', async (c) => {
  const user = c.get('user') as { userId?: string } | undefined;
  if (!user?.userId) {
    return c.json({ message: 'Authentication required' }, 401);
  }

  const parsedBody = mappingUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsedBody.success) {
    return c.json({ message: 'Invalid payload.', errors: parsedBody.error.flatten() }, 400);
  }

  const payload = parsedBody.data;
  const workspaces = await listCodeWorkspacesForUser(user.userId);
  const targetWorkspace = workspaces.find(
    (workspace) => workspace.id === payload.workspaceId,
  );
  if (!targetWorkspace) {
    return c.json({ message: 'Workspace not found in user scope.' }, 404);
  }

  const state = await readWorkspaceState(user.userId);
  const sanitized = sanitizeWorkspaceState(state, workspaces);
  if (!sanitized.state.codeWorkspaceIds.includes(targetWorkspace.id)) {
    return c.json({ message: 'Workspace is not registered as code workspace.' }, 404);
  }
  const nextState: VsCodeProjectWorkspaceState = {
    version: 1,
    mappings: {
      ...sanitized.state.mappings,
      [payload.projectFingerprint]: targetWorkspace.id,
    },
    codeWorkspaceIds: [...sanitized.state.codeWorkspaceIds],
    lastWorkspaceId: targetWorkspace.id,
    updatedAt: new Date().toISOString(),
  };
  await writeWorkspaceState(user.userId, nextState);

  return c.json(
    buildWorkspaceMappingSnapshot({
      projectFingerprint: payload.projectFingerprint,
      state: nextState,
      workspaces,
    }),
  );
});

vscodeExtensionRouter.post(
  '/workspace-mapping/code-workspace',
  requireEditor,
  async (c) => {
    const user = c.get('user') as { userId?: string } | undefined;
    if (!user?.userId) {
      return c.json({ message: 'Authentication required' }, 401);
    }

    const parsedBody = mappingCreateCodeWorkspaceSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsedBody.success) {
      return c.json(
        { message: 'Invalid payload.', errors: parsedBody.error.flatten() },
        400,
      );
    }

    const payload = parsedBody.data;
    const now = new Date();
    const workspaceId = createId();
    const workspaceName =
      normalizeWorkspaceNameCandidate(payload.name) ||
      normalizeWorkspaceNameCandidate(payload.repositoryName) ||
      `Code workspace ${payload.projectFingerprint.slice(0, 8)}`;

    await db.transaction(async (tx) => {
      await tx.insert(workspaces).values({
        id: workspaceId,
        ownerUserId: user.userId!,
        name: workspaceName,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(workspaceMemberships).values({
        workspaceId,
        userId: user.userId!,
        role: 'admin',
        createdAt: now,
      });
    });

    const codeWorkspaces = await listCodeWorkspacesForUser(user.userId);
    const state = await readWorkspaceState(user.userId);
    const sanitized = sanitizeWorkspaceState(state, codeWorkspaces);
    const codeWorkspaceIds = sanitized.state.codeWorkspaceIds.includes(workspaceId)
      ? [...sanitized.state.codeWorkspaceIds]
      : [...sanitized.state.codeWorkspaceIds, workspaceId];
    const nextState: VsCodeProjectWorkspaceState = {
      version: 1,
      mappings: {
        ...sanitized.state.mappings,
        [payload.projectFingerprint]: workspaceId,
      },
      codeWorkspaceIds,
      lastWorkspaceId: workspaceId,
      updatedAt: new Date().toISOString(),
    };
    await writeWorkspaceState(user.userId, nextState);

    return c.json(
      buildWorkspaceMappingSnapshot({
        projectFingerprint: payload.projectFingerprint,
        state: nextState,
        workspaces: codeWorkspaces,
      }),
      201,
    );
  },
);

vscodeExtensionRouter.post('/workspace-mapping/not-now', async (c) => {
  const user = c.get('user') as { userId?: string } | undefined;
  if (!user?.userId) {
    return c.json({ message: 'Authentication required' }, 401);
  }

  const parsedBody = mappingNotNowSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsedBody.success) {
    return c.json({ message: 'Invalid payload.', errors: parsedBody.error.flatten() }, 400);
  }

  const payload = parsedBody.data;
  const workspaces = await listCodeWorkspacesForUser(user.userId);
  const state = await readWorkspaceState(user.userId);
  const sanitized = sanitizeWorkspaceState(state, workspaces);
  const codeWorkspaceIds = sanitized.state.codeWorkspaceIds;
  if (codeWorkspaceIds.length === 0) {
    return c.json(
      { message: 'No code workspace available for fallback.' },
      409,
    );
  }

  const codeIdSet = new Set(codeWorkspaceIds);
  const fallbackWorkspaceId =
    sanitized.state.lastWorkspaceId && codeIdSet.has(sanitized.state.lastWorkspaceId)
      ? sanitized.state.lastWorkspaceId
      : codeWorkspaceIds[0];
  const nextState: VsCodeProjectWorkspaceState = {
    version: 1,
    mappings: {
      ...sanitized.state.mappings,
      [payload.projectFingerprint]: fallbackWorkspaceId,
    },
    codeWorkspaceIds: [...codeWorkspaceIds],
    lastWorkspaceId: fallbackWorkspaceId,
    updatedAt: new Date().toISOString(),
  };
  await writeWorkspaceState(user.userId, nextState);

  return c.json(
    buildWorkspaceMappingSnapshot({
      projectFingerprint: payload.projectFingerprint,
      state: nextState,
      workspaces,
    }),
  );
});
