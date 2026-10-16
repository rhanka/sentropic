/**
 * Lot 1a — Generic approved tool-configuration codec/compiler.
 *
 * A strict, pure, synchronous compiler: it accepts a versioned approved
 * snapshot, a provider manifest and a local handler binding table, and returns
 * an immutable compiled configuration or typed diagnostics BEFORE activation.
 *
 * Properties (spec-v2 §3 minimum shared contract, §5 1a):
 * - Synthetic providers only in tests; no Immo fixture, no SDK dependency,
 *   no approval service and no registry deployment in this package.
 * - Zero I/O: no fetch, no filesystem, no network, no clock. A throwing fetch
 *   anywhere in scope is never called.
 * - Whole-candidate validation: any diagnostic rejects the full candidate.
 * - The compiled configuration is deeply frozen (immutable generation).
 *
 * Reuses the manifest/runtime contracts (`AppMcpProviderManifest`,
 * `CapabilityTool`) as the capability baseline.
 */
import { createHash } from 'node:crypto';
import type { AppMcpProviderManifest, CapabilityTool } from './manifest.js';

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

/** Approved snapshot schema version carried by Lot 1a. */
export const TOOL_CONFIGURATION_SCHEMA_VERSION = 'v1' as const;
export type ToolConfigurationSchemaVersion = typeof TOOL_CONFIGURATION_SCHEMA_VERSION;

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type ToolConfigurationDiagnosticCode =
  | 'invalid_schema_version'
  | 'invalid_identity'
  | 'manifest_digest_mismatch'
  | 'compatibility_digest_mismatch'
  | 'duplicate_tool_name'
  | 'unknown_tool'
  | 'missing_binding'
  | 'capability_ref_mismatch'
  | 'unknown_handler'
  | 'handler_capability_mismatch'
  | 'invalid_values'
  | 'unknown_config_key'
  | 'policy_weakening'
  | 'forbidden_content'
  | 'invalid_provenance'
  | 'malformed_snapshot';

export type ToolConfigurationDiagnostic = {
  code: ToolConfigurationDiagnosticCode;
  path: string;
  message: string;
};

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Local handler entry: compiled local code plus its typed config schema. */
export type ToolConfigurationHandlerBinding = {
  handlerId: string;
  capabilityRef: string;
  configSchema: unknown;
};

/** Per-tool policy overlay. Absent fields inherit the manifest baseline. */
export type ToolPolicyOverlay = {
  requiredScopes?: string[];
  requiredClaims?: string[];
  mutability?: CapabilityTool['mutability'];
  mutatesExternalSystem?: boolean;
  idempotency?: CapabilityTool['idempotency'];
  freshness?: CapabilityTool['freshness'];
  redactionClass?: CapabilityTool['redactionClass'];
  gates?: CapabilityTool['gates'];
};

/** One approved per-tool binding inside the snapshot. */
export type ApprovedToolBinding = {
  toolName: string;
  capabilityRef: string;
  handlerId: string;
  values: Record<string, unknown>;
  policy?: ToolPolicyOverlay;
};

/** Approval provenance. Never carries credentials, bearers or user data. */
export type ToolConfigurationProvenance = {
  approvalRef: string;
  revision: string;
  manifestDigest: string;
  payloadDigest?: string;
  reviewedBy: string[];
};

/** Versioned approved snapshot (untrusted input until compiled). */
export type ApprovedToolSnapshot = {
  schemaVersion: string;
  providerId: string;
  connectorId?: string;
  revision: string;
  manifestDigest: string;
  providerVersion?: string;
  platformVersion?: string;
  compatibilityDigest: string;
  provenance: ToolConfigurationProvenance;
  bindings: ApprovedToolBinding[];
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/** One compiled per-tool entry with effective (non-weakened) policy. */
export type CompiledToolEntry = {
  toolName: string;
  capabilityRef: string;
  handlerId: string;
  values: Record<string, unknown>;
  requiredScopes: string[];
  requiredClaims: string[];
  mutability: CapabilityTool['mutability'];
  mutatesExternalSystem: boolean;
  idempotency: CapabilityTool['idempotency'];
  freshness?: CapabilityTool['freshness'];
  redactionClass: CapabilityTool['redactionClass'];
  gates: CapabilityTool['gates'];
};

/** Immutable compiled configuration (a single generation). */
export type CompiledToolConfiguration = {
  schemaVersion: ToolConfigurationSchemaVersion;
  providerId: string;
  revision: string;
  manifestDigest: string;
  compatibilityDigest: string;
  tools: CompiledToolEntry[];
};

export type CompileToolConfigurationResult =
  | { ok: true; config: CompiledToolConfiguration }
  | { ok: false; diagnostics: ToolConfigurationDiagnostic[] };

