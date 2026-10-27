import '../modules/topology-guard-llm-mesh.js';
import { createModuleRegistry } from '../modules/registry.js';
import type { SpeechBinding, SpeechCapabilities, SpeechCapabilityName, SpeechEngineCatalogue,
  SpeechNegotiationResult, SpeechPlacement, SpeechStage } from '@sentropic/llm-mesh/speech';
import { freezeSpeechSnapshot, type SpeechEgress, type SpeechProfile, type SpeechProfileSelection } from './config.js';

// Inspect version/export metadata before evaluating the optional speech peer.
const { getModelSpeechCapabilities, negotiateSpeech } =
  await createModuleRegistry().load('speech') as typeof import('@sentropic/llm-mesh/speech');

export interface SpeechProjectionContext {
  /** Trusted host scope/policy, never copied from the requested profile. */
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly policyRef: string;
  readonly egressPolicyRef: string;
  readonly budgetRef: string;
  readonly allowedPlacements: readonly SpeechPlacement[];
  readonly allowedEgress: readonly SpeechEgress[];
  readonly online: boolean;
  readonly catalogue: SpeechEngineCatalogue;
  /** Existing host/gateway inventory: no credential resolution or resource allocation here. */
  readonly inspectRoute: (binding: SpeechBinding, stage: SpeechStage) =>
    { readonly available: false } | { readonly available: true;
      readonly requiresNetwork: boolean; readonly egress: SpeechEgress };
}
export type SpeechProjectionReason = 'profile' | 'tenant' | 'policy' | 'placement' | 'route'
  | 'egress' | 'offline' | 'unavailable' | 'identity' | 'selector' | 'capability' | 'format'
  | 'busy' | 'consent' | 'revision';
export interface EffectiveSpeechProjection {
  readonly available: true;
  readonly schemaVersion: 1;
  readonly contentDigest: string;
  readonly profile: SpeechProfile;
  readonly micEnabled: false;
  readonly requiresSessionAdmission: true;
  readonly stages: Readonly<Partial<Record<SpeechStage, {
    readonly capabilities: SpeechCapabilities;
    readonly negotiated: Extract<SpeechNegotiationResult, { ok: true }>;
  }>>>;
}
export type SpeechProjection = EffectiveSpeechProjection
  | { readonly available: false; readonly reason: SpeechProjectionReason; readonly stage?: SpeechStage };
const refused = (reason: SpeechProjectionReason, stage?: SpeechStage): SpeechProjection =>
  ({ available: false, reason, ...(stage ? { stage } : {}) });
const identityKeys = ['providerId', 'modelId', 'modelRevision', 'adapterId', 'adapterRevision', 'placement'] as const;

/** Offline-capable projection of a resolved host snapshot. Never selects an alternate profile. */
export function projectSpeechProfile(profiles: readonly SpeechProfile[], selected: SpeechProfileSelection,
  context: SpeechProjectionContext): SpeechProjection {
  const candidates = profiles.filter((p) => p.profileId === selected.profileId && p.configRevision === selected.configRevision);
  if (!candidates.length) return refused('profile');
  const profile = candidates.find((p) => p.tenantId === context.tenantId && p.workspaceId === context.workspaceId);
  if (!profile) return refused('tenant');
  if (selected.contentDigest !== profile.contentDigest) return refused('revision');
  if (profile.policyRef !== context.policyRef || profile.egressPolicyRef !== context.egressPolicyRef
    || profile.budgetRef !== context.budgetRef) return refused('policy');
  const placements = [profile.placement, ...Object.values(profile.bindings).map((b) => b.placement)];
  if (placements.some((p) => !profile.allowedPlacements.includes(p) || !context.allowedPlacements.includes(p))) {
    return refused('placement');
  }
  const stages: Partial<Record<SpeechStage, { capabilities: SpeechCapabilities;
    negotiated: Extract<SpeechNegotiationResult, { ok: true }> }>> = {};
  for (const stage of ['stt', 'tts', 'duplex'] as const) {
    const binding = profile.bindings[stage];
    if (!binding) continue;
    const entries = getModelSpeechCapabilities(binding.providerId, binding.modelId, context.catalogue)
      .filter((entry) => identityKeys.every((key) => entry.binding[key] === binding[key]));
    if (entries.length !== 1) return refused('unavailable', stage);
    const required: SpeechCapabilityName = stage === 'stt' ? 'streamingStt' : stage === 'tts' ? 'tts' : 'nativeDuplex';
    const negotiated = negotiateSpeech(entries[0], {
      binding, required: [required, ...profile.requiredCapabilities[stage] ?? []],
      ...(stage === 'tts' ? {} : { inputFormats: profile.inputFormats }),
      ...(stage === 'stt' ? {} : { outputFormats: profile.outputFormats }),
    });
    if (!negotiated.ok) return refused(negotiated.reason, stage);
    let route: ReturnType<SpeechProjectionContext['inspectRoute']>;
    try { route = context.inspectRoute(binding, stage); } catch { return refused('route', stage); }
    if (!route?.available) return refused('route', stage);
    if (!profile.allowedEgress.includes(route.egress) || !context.allowedEgress.includes(route.egress)) {
      return refused('egress', stage);
    }
    if (route.requiresNetwork && !context.online) return refused('offline', stage);
    stages[stage] = { capabilities: entries[0], negotiated };
  }
  return freezeSpeechSnapshot(structuredClone({ available: true, schemaVersion: 1, profile,
    contentDigest: profile.contentDigest, micEnabled: false, requiresSessionAdmission: true, stages })) as EffectiveSpeechProjection;
}

export interface SpeechRebindBarrier {
  readonly expectedConfigRevision: string;
  readonly quiescent: boolean;
  readonly cancelled: boolean;
  readonly reconciled: boolean;
  readonly playbackDrained: boolean;
  readonly previousConsentRevision: string;
  readonly consent?: SpeechProfileSelection & {
    readonly egressPolicyRef: string;
    readonly consentRevision: string;
  };
}

/** Host supplies authoritative barrier/consent receipts; this pure check never cancels a turn. */
export function rebindSpeechProfile(current: EffectiveSpeechProjection, profiles: readonly SpeechProfile[],
  selected: SpeechProfileSelection, context: SpeechProjectionContext, barrier: SpeechRebindBarrier): SpeechProjection {
  if (current.profile.tenantId !== context.tenantId || current.profile.workspaceId !== context.workspaceId) {
    return refused('tenant');
  }
  if (barrier.expectedConfigRevision !== current.profile.configRevision) return refused('revision');
  if (![barrier.quiescent, barrier.cancelled, barrier.reconciled, barrier.playbackDrained].every((v) => v === true)) {
    return refused('busy');
  }
  const next = projectSpeechProfile(profiles, selected, context);
  if (!next.available) return next;
  if (current.profile.profileId === next.profile.profileId && current.profile.configRevision === next.profile.configRevision
    && current.contentDigest !== next.contentDigest) return refused('revision');
  const consent = barrier.consent;
  if (!consent || consent.profileId !== next.profile.profileId || consent.configRevision !== next.profile.configRevision
    || consent.contentDigest !== next.contentDigest
    || consent.egressPolicyRef !== next.profile.egressPolicyRef || !consent.consentRevision?.trim()
    || !barrier.previousConsentRevision?.trim() || consent.consentRevision === barrier.previousConsentRevision) {
    return refused('consent');
  }
  return next;
}
