import type { ClusterMeshHonoNamespaceModule } from '@sentropic/cluster-mesh';
import {
  createLlmMeshRouter,
  type CreateLlmMeshRouterOptions,
} from './llm-mesh-router';
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';

import { requireAuth, type AuthUser } from '../../middleware/auth';
import { requireAdmin } from '../../middleware/rbac';
import {
  getModelCatalogPayload,
  inferProviderFromModelIdWithLegacy,
  resolveDefaultSelection,
} from '../../services/model-catalog';
import {
  getAnthropicTransportMode,
  getOpenAITransportMode,
  listProviderConnections,
  setOpenAITransportMode,
} from '../../services/provider-connections';
import { settingsService } from '../../services/settings';
import { productLlmMeshEnrollmentPort } from './llm-mesh-enrollment';
import { applyLlmMeshAuthorFence, LLM_MESH_PATHS } from './llm-mesh-cutover';

const aiSettingsSchema = z.object({
  defaultProviderId: z.enum(['openai', 'gemini', 'anthropic', 'mistral', 'cohere', 'gcp', 'local']).optional(),
  defaultModel: z.string().min(1).optional(),
}).refine(
  (value) => value.defaultProviderId !== undefined || value.defaultModel !== undefined,
  { message: 'At least one field is required' },
);
const transportModeSchema = z.object({ mode: z.enum(['codex', 'token']) });
export const LLM_MESH_ADMIN_PATHS = [
  '/settings/provider-connections',
  '/settings/provider-connections/openai/mode',
  '/settings/provider-connections/:providerId/enrollment/:action',
] as const;
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

export const createProductLlmMeshRouterOptions = (): CreateLlmMeshRouterOptions => ({
  resolvePrincipal(context) {
    const user = context.get('user') as AuthUser | undefined;
    return user?.userId ? { userId: user.userId, role: user.role } : undefined;
  },
  catalog: {
    async readCatalog({ principal }) {
      try {
        return json(await getModelCatalogPayload({ userId: principal.userId }));
      } catch (error) {
        console.error('Error fetching model catalog:', error);
        return json({ message: 'Failed to fetch model catalog' }, 500);
      }
    },
    async readUserSettings({ principal }) {
      const [current, catalog] = await Promise.all([
        settingsService.getAISettings({ userId: principal.userId }),
        getModelCatalogPayload({ userId: principal.userId }),
      ]);
      const resolved = resolveDefaultSelection({
        providerId: current.defaultProviderId,
        modelId: current.defaultModel,
      }, catalog.models);
      return json({ defaultProviderId: resolved.provider_id, defaultModel: resolved.model_id });
    },
    async updateUserSettings({ principal, request }) {
      const parsed = aiSettingsSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return json({ message: 'Invalid AI settings request' }, 400);
      const [current, catalog] = await Promise.all([
        settingsService.getAISettings({ userId: principal.userId }),
        getModelCatalogPayload({ userId: principal.userId }),
      ]);
      const inferred = inferProviderFromModelIdWithLegacy(catalog.models, parsed.data.defaultModel);
      const resolved = resolveDefaultSelection({
        providerId: parsed.data.defaultProviderId ?? inferred ?? current.defaultProviderId,
        modelId: parsed.data.defaultModel ?? current.defaultModel,
      }, catalog.models);
      await Promise.all([
        settingsService.set('default_provider_id', resolved.provider_id, 'User default AI provider', { userId: principal.userId }),
        settingsService.set('default_model', resolved.model_id, 'User default AI model', { userId: principal.userId }),
      ]);
      return json({
        success: true,
        settings: { defaultProviderId: resolved.provider_id, defaultModel: resolved.model_id },
      });
    },
  },
  pool: {
    async readAvailability({ principal }) {
      try {
        const providers = await listProviderConnections({ userId: principal.userId });
        return json({ providers: providers.map(({ providerId, label, ready, managedBy, accountLabel }) => ({
          providerId, label, ready, managedBy, accountLabel,
        })) });
      } catch (error) {
        console.error('Error fetching provider readiness:', error);
        return json({ message: 'Failed to fetch provider readiness' }, 500);
      }
    },
    async readConnections({ principal }) {
      const [providers, openaiTransportMode, anthropicTransportMode] = await Promise.all([
        listProviderConnections({ userId: principal.userId }),
        getOpenAITransportMode(),
        getAnthropicTransportMode(),
      ]);
      return json({ providers, openaiTransportMode, anthropicTransportMode });
    },
    async updateTransportMode({ providerId, request }) {
      if (providerId !== 'openai') return json({ message: 'Transport mode route not found' }, 404);
      const parsed = transportModeSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return json({ message: 'Invalid transport mode request' }, 400);
      return json({ mode: await setOpenAITransportMode(parsed.data.mode) });
    },
  },
  enrollment: productLlmMeshEnrollmentPort,
});

export interface CreateLlmMeshNamespaceModuleOptions {
  readonly enabled?: boolean;
  readonly authenticate?: MiddlewareHandler;
  readonly authorizeAdmin?: MiddlewareHandler;
  readonly routerOptions?: CreateLlmMeshRouterOptions;
}

export const createLlmMeshNamespaceModule = (
  options: CreateLlmMeshNamespaceModuleOptions = {},
): ClusterMeshHonoNamespaceModule => ({
  namespace: '/llm-mesh',
  enabled: options.enabled ?? true,
  createRouter() {
    const router = new Hono();
    for (const path of LLM_MESH_PATHS) {
      router.use(path, options.authenticate ?? requireAuth);
    }
    for (const path of LLM_MESH_ADMIN_PATHS) {
      router.use(path, options.authorizeAdmin ?? requireAdmin);
    }
    applyLlmMeshAuthorFence(router);
    router.route('/', createLlmMeshRouter(
      options.routerOptions ?? createProductLlmMeshRouterOptions(),
    ));
    return router;
  },
});

export const productLlmMeshModule = createLlmMeshNamespaceModule();
