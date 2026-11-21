import {
  createArtifactCommentsRouter,
  type CreateArtifactCommentsRouterOptions,
} from '@sentropic/comments/artifact-hono';
import { Hono, type MiddlewareHandler } from 'hono';

import { requireAuth } from '../../middleware/auth';
import { createProductArtifactCommentsRouterOptions } from './artifact-comments-ports';

export const ARTIFACT_COMMENTS_PATH = '/artifacts/:artifactId/comments/*' as const;

export interface CreateArtifactCommentsNamespaceOptions {
  readonly authenticate?: MiddlewareHandler;
  readonly routerOptions?: CreateArtifactCommentsRouterOptions;
}

export const createArtifactCommentsNamespaceRouter = (
  options: CreateArtifactCommentsNamespaceOptions = {},
): Hono => {
  const router = new Hono();
  router.use(ARTIFACT_COMMENTS_PATH, options.authenticate ?? requireAuth);
  router.route('/', createArtifactCommentsRouter(
    options.routerOptions ?? createProductArtifactCommentsRouterOptions(),
  ));
  return router;
};
