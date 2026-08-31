import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { apiRouter } from './routes/api';
import { env } from './config/env';
import { isOriginAllowed, parseAllowedOrigins } from './utils/cors';
import { applyAuthRateLimiters } from './middleware/auth-rate-limiters';
import { logger } from './logger';
import { createClusterMeshPlugin } from '@sentropic/cluster-mesh';
import { clusterMeshAdapter } from './services/cluster-mesh-adapter';
import { productSessionModule } from './routes/namespaces/session';
import { productMcpModule } from './routes/namespaces/mcp';
import {
  createOAuthNamespaceModule,
  createOAuthWellKnownProjection,
} from './routes/namespaces/oauth';
import { productAuthPlugin } from './routes/namespaces/auth';
import { productGwModule } from './routes/namespaces/gw';
import { productChatModule } from './routes/namespaces/chat';
import { productFocusModule } from './routes/namespaces/focus';
import { productTrackModule } from './routes/namespaces/track';
import {
  LLM_MESH_ADMIN_PATHS,
  productLlmMeshModule,
} from './routes/namespaces/llm-mesh';
import { LLM_MESH_PATHS } from './routes/namespaces/llm-mesh-cutover';
import { productWorkflowsModule } from './routes/namespaces/workflows';
import {
  WORKFLOW_ADMIN_PATHS,
  WORKFLOW_PATHS,
} from './routes/namespaces/workflows-cutover';
import { productCommentsModule } from './routes/namespaces/comments';
import { COMMENTS_PATHS } from './routes/namespaces/comments-cutover';
import { productConnectorsModule } from './routes/namespaces/connectors';
import {
  CONNECTOR_ADMIN_PATHS,
  CONNECTOR_PATHS,
} from './routes/namespaces/connectors-cutover';

const authPlugin = productAuthPlugin();

export interface PrivilegedPathFence {
  readonly name: string;
  readonly paths: readonly string[];
  readonly pathPrefixes: readonly string[];
}

export interface RootMountedNamespaceRegistration {
  readonly namespace: string;
  readonly module: typeof productLlmMeshModule;
  readonly authPaths: readonly string[] | null;
  readonly privilegedFences?: readonly PrivilegedPathFence[];
}

export const ROOT_MOUNTED_NAMESPACE_REGISTRY = [
  {
    namespace: '/auth',
    module: authPlugin.module,
    authPaths: null,
  },
  {
    namespace: '/llm-mesh',
    module: productLlmMeshModule,
    authPaths: LLM_MESH_PATHS,
    privilegedFences: [{
      name: 'admin',
      paths: LLM_MESH_ADMIN_PATHS,
      pathPrefixes: ['/settings/provider-connections'],
    }],
  },
  {
    namespace: '/workflows',
    module: productWorkflowsModule,
    authPaths: WORKFLOW_PATHS,
    privilegedFences: [{
      name: 'admin',
      paths: WORKFLOW_ADMIN_PATHS,
      pathPrefixes: [],
    }],
  },
  {
    namespace: '/comments',
    module: productCommentsModule,
    authPaths: COMMENTS_PATHS,
  },
  {
    namespace: '/connectors',
    module: productConnectorsModule,
    authPaths: CONNECTOR_PATHS,
    privilegedFences: [{
      name: 'admin',
      paths: CONNECTOR_ADMIN_PATHS,
      pathPrefixes: ['/settings/connector-accounts'],
    }],
  },
] as const satisfies readonly RootMountedNamespaceRegistration[];

export const ROOT_MOUNT_REMAPS = Object.fromEntries(
  ROOT_MOUNTED_NAMESPACE_REGISTRY.map(({ namespace }) => [namespace, '/']),
);
const [productAuthRootRegistration, ...productFencedRootRegistrations] =
  ROOT_MOUNTED_NAMESPACE_REGISTRY;

export const app = new Hono();
const httpLogEnabled = env.HTTP_LOG !== 'false' && env.HTTP_LOG !== '0';

// Parse allowed origins from environment variable
const allowedOrigins = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);

// Security Headers (CSP, HSTS, COOP)
// secureHeaders() returns a middleware — invoke the factory ONCE, register the result.
// NOTE: CORP and COEP are NOT set here because they block legitimate cross-origin
// API requests from the frontend (e.g. localhost:5173 → localhost:8787).
// CORP is applied selectively per-route below (e.g. bookmarklet endpoints).
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "https://*.sent-tech.ca"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
    strictTransportSecurity: 'max-age=31536000; includeSubDomains; preload',
    crossOriginOpenerPolicy: 'same-origin',
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    xContentTypeOptions: 'nosniff',
    xFrameOptions: 'DENY',
    xXssProtection: '1; mode=block',
    referrerPolicy: 'strict-origin-when-cross-origin',
  }),
);

// Explicit CORP for public bookmarklet endpoints (must be cross-origin loadable).
// Global CORP is disabled to allow cross-origin API requests; these endpoints
// explicitly opt in to 'cross-origin' so browsers can load them from any origin.
app.use('/api/v1/bookmarklet/injected-script.js', async (c, next) => {
  await next();
  c.res.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
});
app.use('/api/v1/bookmarklet/probe.js', async (c, next) => {
  await next();
  c.res.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
});

// Global HTTP logging (opt-in)
app.use('*', async (c, next) => {
  if (!httpLogEnabled) return next();
  const startedAt = Date.now();
  const method = c.req.method;
  const path = c.req.path;
  const workspaceId = c.req.query('workspace_id') || null;
  try {
    await next();
  } finally {
    if (method !== 'OPTIONS') {
      const status = c.res?.status ?? 0;
      logger.info(
        { method, path, status, workspaceId, ms: Date.now() - startedAt },
        'http'
      );
    }
  }
});

// Custom CORS middleware (strict mode with credentials)
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin');
  const method = c.req.method;
  
  // Handle preflight OPTIONS requests
  if (method === 'OPTIONS') {
    if (origin && isOriginAllowed(origin, allowedOrigins)) {
      const requestedHeaders = c.req.header('Access-Control-Request-Headers');
      const allowHeaders = requestedHeaders
        ? requestedHeaders
            .split(',')
            .map((h) => h.trim())
            .filter(Boolean)
            .join(',')
        : 'Content-Type,Authorization,X-App-Locale';
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      c.header('Access-Control-Allow-Headers', allowHeaders);
      c.header('Access-Control-Allow-Credentials', 'true');
      c.header('Access-Control-Max-Age', '86400');
    }
    return c.body(null, 204);
  }
  
  await next();

  // Apply CORS headers to the final response. Some routes forward raw Response
  // objects, so headers set before next() would otherwise be lost.
  if (origin && isOriginAllowed(origin, allowedOrigins)) {
    c.res.headers.set('Access-Control-Allow-Origin', origin);
    c.res.headers.set('Access-Control-Allow-Credentials', 'true');
  }
});

// Auth rate limiters are shared with the standalone IdP (apps/auth-idp) — see
// api/src/middleware/auth-rate-limiters.ts. Order matters; the helper owns it.
applyAuthRateLimiters(app);

app.route('/.well-known', createOAuthWellKnownProjection({
  compositionRoot: 'product',
  publicPath: '/api/v1/oauth',
}));
export const PRODUCT_CLUSTER_MESH_MOUNTS = {
  '/session': '/auth',
  ...ROOT_MOUNT_REMAPS,
} as const;
app.route('/api/v1', createClusterMeshPlugin({
  runtime: clusterMeshAdapter.sessionControl!.runtime,
  namespaces: [
    productSessionModule,
    productMcpModule,
    createOAuthNamespaceModule({ compositionRoot: 'product', publicPath: '/api/v1/oauth' }),
    productAuthRootRegistration.module,
    productGwModule,
    productChatModule,
    productFocusModule,
    productTrackModule,
    ...productFencedRootRegistrations.map(({ module }) => module),
  ],
  mounts: PRODUCT_CLUSTER_MESH_MOUNTS,
}));
app.route('/api/v1', apiRouter);

app.get('/', (c) => c.json({ name: 'Sentropic API', version: '0.1.0' }));
