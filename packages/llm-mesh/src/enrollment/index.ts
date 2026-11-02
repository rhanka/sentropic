// Public enrollment contract exports for @sentropic/llm-mesh/enrollment

export type {
  AccountPublic,
  CredentialEnvelope,
  EnrollmentCompletion,
  EnrollmentProvider,
  EnrollmentSession,
  PreparedCredential,
  ResolvedProviderMetadata,
  StartEnrollmentInput,
} from './contracts.js';
export type { AgyApplicationTuple, AgySeatPersistence, AgySeatProjectionInput } from './agy-cli-import.js';
export { AgyMappingError, persistAgySeatProjection, translateAgySeatToApplication } from './agy-cli-import.js';
export type { CliSeatProfileInput, SeatSourceMode, TokenSeatEnvelopeInput } from './cli-seat-import.js';
export { parseCliSeatProfile, parseTokenSeatEnvelope, sameSeatLineage, SeatImportError } from './cli-seat-import.js';
export type {
  PbtxtField,
  PbtxtScalar,
  SeatCellSynthesis,
  SeatEnvelopeV1,
  SeatLaunchGate,
  SeatOnboardingCode,
  SeatOnboardingDestKey,
  SeatOnboardingFile,
  SeatOnboardingFormat,
  SeatOnboardingStatus,
  SeatOnboardingV1,
  SeatEnvelopeValidationResult,
  SeatOnboardingValidationResult,
} from './seat-onboarding.js';
export {
  AGY_REQUIRED_COMPLETED_STEPS,
  CODEX_APPROVAL_POLICY_VALUES,
  MUSE_TRUST_KNOWN_SCHEMA_VERSIONS,
  SEAT_ENVELOPE_AUTH_FILES,
  SEAT_ONBOARDING_FILE_CAPS,
  SEAT_ONBOARDING_MAX_BYTES,
  SEAT_ONBOARDING_SCHEMA_VERSION,
  SeatOnboardingError,
  canonicalAgyJetskiBytes,
  canonicaliseAgyJetski,
  parseAgyJetskiPbtxt,
  rebindSeatOnboarding,
  seatLaunchGate,
  validateAgyJetskiContent,
  validateOnboardingFileContent,
  validateSeatEnvelope,
  validateSeatOnboarding,
} from './seat-onboarding.js';

export type { CodexMcpServerSpec, CodexSeatIntent } from './seat-onboarding-projections.js';
export {
  CODEX_TRUST_DIALOG_PROBE,
  projectClaudeOnboarding,
  projectCodexIntent,
  projectMuseTrust,
  renderCodexSeatConfig,
} from './seat-onboarding-projections.js';
