/** AMD-ISO: compile-only data contract; no capability is enabled by importing it. */
export const COMPILE_API_VERSION = 1 as const;
export const COMPILE_RECIPE_DOMAIN = 'h2a.vue.compile.recipe@1\n' as const;
export const COMPILE_ISOLATE_PROFILE = 'isolate.local-isolated-vm.compile-only.v1' as const;
export type CompileKindV1 = 'vue-sfc' | 'vue-template';
export type CompileProfileV1 = 'browser-vapor' | 'browser-vue' | 'ssr-module';
export interface CompilePackageV1 { name: string; version: string; sha256: string }
export interface CompileSourceV1 { path: string; bytesBase64: string }
export type CompileWorkspaceV1 =
  | { mode: 'source'; exports: Record<string, string> }
  | { mode: 'mirror'; version: string; manifestEntryDigest: string };
export type CompileAliasV1 =
  | { kind: 'prefix'; from: string; to: string }
  | { kind: 'replacement'; from: string; to: string; profile: CompileProfileV1 };
/** All effective defaults are explicit; no source-selected plugins or environment. */
export interface CompileOptionsV1 {
  workspaceMap: Record<string, CompileWorkspaceV1>;
  aliases: CompileAliasV1[];
  extensions: string[];
  urlRewriteMode: 'import-map-external' | 'resolved-url';
  sourcemap: boolean;
}
export interface CompileRecipeV1 {
  recipeVersion: 1;
  sources: CompileSourceV1[];
  entry: string;
  kind: CompileKindV1;
  profile: CompileProfileV1;
  compilers: (CompilePackageV1 & { role: string })[];
  dsTuple: CompilePackageV1[];
  dependencyLockDigest: string;
  importMapManifestDigest: string;
  catalogDigest: string;
  options: CompileOptionsV1;
  policyVersion: 'compile-policy.v1';
  trustLane: 'isolate-untrusted';
  accessPartition: string;
}
export interface CompileOutputDescriptorV1 {
  path: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  sri: string;
  visibility: 'public' | 'private';
}
export interface CompileOutputManifestV1 {
  apiVersion: 1;
  recipeKey: string;
  entry: string;
  css: string[];
  outputs: CompileOutputDescriptorV1[];
  modules: string[];
  dependencies: CompilePackageV1[];
  notices: string[];
}
export const COMPILE_DIAGNOSTIC_CODES = [
  'missing_tenant_id', 'custody_revoked', 'command_id_payload_mismatch', 'tenant_quota_exceeded',
  'identity_scope_mismatch', 'scope_projection_refused', 'virtual_source_grant_refused',
  'access_partition_mismatch', 'invalid_recipe', 'invalid_source_path', 'duplicate_normalized_path',
  'invalid_recipe_option', 'unsupported_kind', 'unsupported_profile', 'unsupported_import',
  'workspace_unresolved', 'compiler_integrity_refused', 'dependency_integrity_refused',
  'catalog_digest_mismatch', 'catalog_incompatible', 'catalog_document_invalid', 'unknown_component',
  'invalid_property', 'document_too_large', 'document_too_deep', 'document_too_many_nodes',
  'catalog_validator_timeout', 'compile_deadline_exceeded', 'compile_cancelled',
  'compile_quota_exceeded', 'missing_isolate', 'compiler_failed', 'output_missing',
  'output_corrupt', 'output_manifest_mismatch', 'diagnostics_truncated',
] as const;
export type CompileDiagnosticCodeV1 = typeof COMPILE_DIAGNOSTIC_CODES[number];
export type CompileRefusalCodeV1 = Exclude<CompileDiagnosticCodeV1, 'diagnostics_truncated'>;
export const COMPILE_DIAGNOSTIC_STAGES = [
  'admission', 'scope-projection', 'recipe-validation', 'catalog-validation', 'resolve',
  'parse', 'transform', 'link', 'verify-output', 'serve', 'cleanup',
] as const;
export interface CompileDiagnosticV1 {
  code: CompileDiagnosticCodeV1;
  severity: 'warning' | 'error';
  stage: typeof COMPILE_DIAGNOSTIC_STAGES[number];
  message: string;
  path?: string;
  range?: { start: number; end: number };
}
export type CompileResultV1 =
  | { apiVersion: 1; status: 'ok'; digest: string; manifestDigest: string;
      manifest: CompileOutputManifestV1; module: CompileOutputDescriptorV1;
      css: CompileOutputDescriptorV1[]; diagnostics: CompileDiagnosticV1[] }
  | { apiVersion: 1; status: 'refused'; code: CompileRefusalCodeV1; diagnostics: CompileDiagnosticV1[] };
export interface CompileRequestV1 { apiVersion: 1; recipe: CompileRecipeV1 }
export interface CompileServeRequestV1 {
  apiVersion: 1; digest: string; manifestDigest: string; path: string;
}
export type CompileServeResultV1 = Exclude<CompileResultV1, { status: 'ok' }>
  | { apiVersion: 1; status: 'ok'; digest: string; manifestDigest: string;
      output: CompileOutputDescriptorV1; bytes: Uint8Array };

/** Constructed by the authenticated host, never deserialized from recipe authority. */
export interface CompileExecutionContext {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly attemptId: string;
  readonly purpose: string;
  readonly resourceId: string;
  readonly custodyEpoch: number;
  readonly devScope: {
    readonly kind: 'ui' | 'fullstack';
    readonly writable: readonly string[];
    readonly refused: readonly string[];
    readonly source: { readonly repo: string; readonly path: string; readonly commit: string };
  };
  readonly virtualSourceManifest: Readonly<Record<string, string>>;
  readonly virtualSourceGrants: readonly {
    readonly path: string; readonly sha256: string; readonly grantId: string;
  }[];
  readonly destinationAuthorization: {
    readonly resourceId: string; readonly action: 'preview' | 'publish' | 'serve';
    readonly authorizationId: string;
  };
  readonly deadlineAt: string;
  readonly commandId: string;
  readonly signal: AbortSignal;
}
export interface VueCompileAdapter {
  compile(request: CompileRequestV1, context: CompileExecutionContext): Promise<CompileResultV1>;
  serve(request: CompileServeRequestV1, context: CompileExecutionContext): Promise<CompileServeResultV1>;
}
