import type {
  AppConnectorProviderAdapter,
  AppResourceRead,
  AppResourceResult,
  AppToolInvocation,
  AppToolResult,
  ConnectorSecretStatus,
} from '../../mcp-platform/src/runtime.js';
import type {
  ConnectorTenantContext,
  ConnectorTenantResolutionInput,
} from '../../mcp-platform/src/manifest.js';
import { googleDriveManifest } from './manifest.js';
import {
  aboutFixture,
  filesListFixture,
  filesMetadataMap,
  filesExportMap,
  permissionsMap,
  commentsMap,
} from './fixtures.js';

export function createGoogleDriveAdapter(): AppConnectorProviderAdapter {
  return {
    appId: googleDriveManifest.appId,
    connectorId: googleDriveManifest.providerId,
    manifest: googleDriveManifest,

    async resolveTenant(input: ConnectorTenantResolutionInput): Promise<ConnectorTenantContext> {
      // Narrow-only: preserve the core-authorized tenant and principal constraints.
      return {
        principalRef: input.principalSub,
        tenantRef: input.tenantRef,
        workspaceRef: input.workspaceRef,
        connectorInstanceId: input.connectorInstanceId,
        domainScopeRef: `googledrive-tenant:${input.tenantRef}`,
      };
    },

    async listCapabilities() {
      return [
        ...googleDriveManifest.resources,
        ...googleDriveManifest.tools,
        ...googleDriveManifest.prompts,
      ];
    },

    async readResource(req: AppResourceRead): Promise<AppResourceResult> {
      const uri = req.input.uri;
      const tenantRef = req.ctx.tenantRef;

      // Match URI paths and return synthetic fixtures.
      // Template: googledrive://{tenantRef}/about
      if (uri === `googledrive://${tenantRef}/about`) {
        return {
          ok: true,
          output: aboutFixture,
          auditId: req.ctx.auditId,
          redactionClass: 'low',
        };
      }

      // Template: googledrive://{tenantRef}/files/{fileId}/permissions
      const permissionsRegex = new RegExp(`^googledrive://${tenantRef}/files/([^/]+)/permissions$`);
      const permissionsMatch = uri.match(permissionsRegex);
      if (permissionsMatch) {
        const fileId = permissionsMatch[1];
        const permissions = permissionsMap[fileId] ?? [];
        return {
          ok: true,
          output: { permissions },
          auditId: req.ctx.auditId,
          redactionClass: 'moderate',
        };
      }

      // Template: googledrive://{tenantRef}/files/{fileId}/comments
      const commentsRegex = new RegExp(`^googledrive://${tenantRef}/files/([^/]+)/comments$`);
      const commentsMatch = uri.match(commentsRegex);
      if (commentsMatch) {
        const fileId = commentsMatch[1];
        const comments = commentsMap[fileId] ?? [];
        return {
          ok: true,
          output: { comments },
          auditId: req.ctx.auditId,
          redactionClass: 'moderate',
        };
      }

      // Template: googledrive://{tenantRef}/files/{fileId}
      const fileGetRegex = new RegExp(`^googledrive://${tenantRef}/files/([^/]+)$`);
      const fileGetMatch = uri.match(fileGetRegex);
      if (fileGetMatch) {
        const fileId = fileGetMatch[1];
        const fileMetadata = filesMetadataMap[fileId];
        if (!fileMetadata) {
          return {
            ok: false,
            auditId: req.ctx.auditId,
            redactionClass: 'low',
            error: {
              code: 'file_not_found',
              message: `File with ID ${fileId} not found in synthetic fixtures.`,
              retriable: false,
            },
          };
        }
        return {
          ok: true,
          output: fileMetadata,
          auditId: req.ctx.auditId,
          redactionClass: 'low',
        };
      }

      // Template: googledrive://{tenantRef}/files
      if (uri === `googledrive://${tenantRef}/files`) {
        return {
          ok: true,
          output: filesListFixture,
          auditId: req.ctx.auditId,
          redactionClass: 'low',
        };
      }

      // Default fallback for unknown resources
      return {
        ok: false,
        auditId: req.ctx.auditId,
        redactionClass: 'none',
        error: {
          code: 'resource_not_found',
          message: `Resource URI '${uri}' does not match any registered templates or tenant constraints.`,
          retriable: false,
        },
      };
    },

    async invokeTool(req: AppToolInvocation): Promise<AppToolResult> {
      if (req.capabilityRef === 'files.export') {
        const input = req.input as { fileId: string; mimeType: string };
        const { fileId, mimeType } = input;

        if (!fileId || !mimeType) {
          return {
            ok: false,
            auditId: req.ctx.auditId,
            redactionClass: 'moderate',
            error: {
              code: 'invalid_argument',
              message: 'fileId and mimeType parameters are required.',
              retriable: false,
            },
          };
        }

        const exportResult = filesExportMap[fileId];
        if (exportResult) {
          return {
            ok: true,
            output: {
              content: exportResult.content,
              mimeType: mimeType,
            },
            auditId: req.ctx.auditId,
            redactionClass: 'moderate',
          };
        }

        // Generic export fallback for other files
        return {
          ok: true,
          output: {
            content: `Synthetic exported content for file ${fileId} in format ${mimeType}`,
            mimeType: mimeType,
          },
          auditId: req.ctx.auditId,
          redactionClass: 'moderate',
        };
      }

      return {
        ok: false,
        auditId: req.ctx.auditId,
        redactionClass: 'none',
        error: {
          code: 'tool_not_found',
          message: `Tool '${req.capabilityRef}' not found.`,
          retriable: false,
        },
      };
    },

    async validateSecrets(): Promise<ConnectorSecretStatus> {
      return [
        {
          name: 'accessToken',
          scope: 'connector-instance',
          state: 'active',
        },
      ];
    },
  };
}
