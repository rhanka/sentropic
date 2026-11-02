export type { KeyringAdapter } from '../service/facade.js';
export type {
  SeatAccessProjection,
  SeatAuthority,
  SeatBundleIdentity,
  SeatBundleLifecycle,
  SeatBundleProvenance,
  SeatBundleV1,
  SeatCanonicalMaterial,
  SeatCli,
  SeatCredentialClass,
  SeatLineageTuple,
  SeatReceipt,
  SeatRefreshAuthority,
  SeatTransition,
  SeatValidationCode,
  SeatValidationContext,
  SeatValidationResult,
} from '../enrollment/seat-bundle.js';
export {
  SEAT_AGY_APPLICATION_TUPLE,
  SEAT_BUNDLE_MAX_BYTES,
  SEAT_BUNDLE_SCHEMA_VERSION,
  SEAT_PACKAGE_PROVIDER_ID,
  classifyTransition,
  createReceipt,
  isIdempotentReimport,
  isStaleGeneration,
  resolveEffectiveAuthority,
  validateSeatBundle,
} from '../enrollment/seat-bundle.js';
export type {
  SeatRecordSelector,
  SeatStoreBackend,
  SeatStoreRecordDescriptor,
} from './cli-seat-store-reader.js';
export { inspectSeatStoreRecord, SeatStoreReadError } from './cli-seat-store-reader.js';
export type { SeatSidecar } from './seat-sidecar-file-backend.js';
export { SEAT_SIDECAR_MAX_BYTES, SeatSidecarFileBackend, parseSeatSidecar } from './seat-sidecar-file-backend.js';
export type { SeatExternalAuthority } from '../service/external-seat-authority.js';
export {
  SEAT_EXTERNAL_AUTHORITY_KEY,
  isDeviceFlowSeatAccount,
  isExternalSeatAccount,
  isExternalSeatUnavailable,
  markExternalSeatAuthority,
  readExternalSeatAuthority,
} from '../service/external-seat-authority.js';
export {
  EncryptedFileKeyring,
  KeyringInsecurePermissionsError,
} from './keyring/encrypted-file-keyring.js';
export { EnvKeyring } from './keyring/env-keyring.js';
export { InMemoryKeyring } from './keyring/in-memory-keyring.js';
export { LinuxSecretstoreKeyring } from './keyring/linux-secretstore-keyring.js';
export { MacOSKeychainKeyring } from './keyring/macos-keychain-keyring.js';
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
} from '../enrollment/seat-onboarding.js';
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
} from '../enrollment/seat-onboarding.js';

export type {
  SeatCaptureInput,
  SeatCaptureResult,
  SeatCaptureSelector,
} from './seat-onboarding-capture.js';
export { CAPTURE_SOURCES, captureSeatOnboarding } from './seat-onboarding-capture.js';

export type {
  SeatCellConfigDirs,
  SeatCellInput,
  SeatCellReceipt,
  SeatCellReceiptFile,
  SeatCellResult,
  SeatCodexMcpServer,
  SeatEraseResult,
  SeatStageInput,
  SeatStageInputSeat,
  SeatStageReceipt,
  SeatStageReceiptEntry,
  SeatStageReceiptOnboarding,
  SeatStageResult,
} from './seat-onboarding-materialize.js';
export {
  SEAT_RECORD_REL_PATH,
  eraseSeatHome,
  materialiseCellHome,
  materialiseSeatEnvelopes,
} from './seat-onboarding-materialize.js';

export type { CodexMcpServerSpec, CodexSeatIntent } from '../enrollment/seat-onboarding-projections.js';
export {
  CODEX_TRUST_DIALOG_PROBE,
  projectClaudeOnboarding,
  projectCodexIntent,
  projectMuseTrust,
  renderCodexSeatConfig,
} from '../enrollment/seat-onboarding-projections.js';
