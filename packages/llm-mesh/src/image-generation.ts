import type { AuthInput, AuthResolver } from './auth.js';
import type { LlmMeshRequestMetadata } from './generation.js';
import type { ModelSelection } from './generation.js';
import type { ModelId, ProviderId } from './providers.js';

export type ImageGenerationStatus = 'supported' | 'unsupported' | 'planned';

export type ImageGenerationKind =
  | 'native-image-model'
  | 'gemini-generate-content'
  | 'provider-agent-tool'
  | 'none';

export interface ImageGenerationControls {
  aspectRatio?: string;
  size?: string;
  quality?: string;
  background?: 'transparent' | 'opaque' | (string & {});
  count?: number;
  referenceImages?: readonly string[];
  providerOptions?: Record<string, unknown>;
}

export interface ImageGenerationMetadata {
  providerMetadata?: Record<string, unknown>;
  generatedBy?: string;
}

export interface GeneratedImage {
  mimeType: string;
  url?: string;
  data?: string;
  width?: number;
  height?: number;
  metadata?: Record<string, unknown>;
}

export interface ImageGenerationRequest extends ImageGenerationControls {
  model?: ModelSelection;
  providerId?: ProviderId;
  modelId?: ModelId;
  prompt: string;
  auth?: AuthInput | AuthResolver;
  signal?: AbortSignal;
  metadata?: LlmMeshRequestMetadata;
}

export interface ImageGenerationResponse extends ImageGenerationMetadata {
  id: string;
  providerId: ProviderId;
  modelId: ModelId;
  images: readonly GeneratedImage[];
  status?: 'completed' | 'refused' | 'failed';
  refusalReason?: string;
  text?: string;
}
