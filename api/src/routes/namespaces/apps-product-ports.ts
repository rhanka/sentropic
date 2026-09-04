import { ZodError } from 'zod';

import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import {
  AppControlPlaneConflictError,
  AppControlPlaneNotFoundError,
  AppControlPlaneValidationError,
  appControlPlane,
} from '../../services/app-control-plane';
import type { AppsHttpError, AppsNamespacePorts } from './apps';

export const requireAppsAdmin = requireRole('admin_app');

const mapAppsError = (error: unknown): AppsHttpError => {
  if (error instanceof ZodError || error instanceof SyntaxError
    || error instanceof AppControlPlaneValidationError) {
    return { status: 400, error: 'invalid_app_request' };
  }
  if (error instanceof AppControlPlaneNotFoundError
    || (error instanceof Error && /^app_(template|instance)_not_found$/.test(error.message))) {
    return { status: 404, error: error instanceof Error ? error.message : 'app_control_not_found' };
  }
  if (error instanceof AppControlPlaneConflictError) {
    return { status: 409, error: 'app_control_conflict' };
  }
  return { status: 500, error: 'app_control_unavailable' };
};

export const productAppsPorts: AppsNamespacePorts = {
  controlPlane: appControlPlane,
  authenticate: requireAuth,
  authorizeAdminApp: requireAppsAdmin,
  mapError: mapAppsError,
};
