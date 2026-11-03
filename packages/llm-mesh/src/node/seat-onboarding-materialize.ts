//
// Two-stage seat materialization and erasure (public barrel). Stage 1
// stages validated envelopes into per-seat directories; stage 2 seeds one
// fresh cell HOME from a staged seat record; erasure wipes either root.
// Implementations live in the sibling modules and import only Node builtins
// plus the enrollment modules, keeping the bench vendor set dependency-closed.

export { SEAT_RECORD_REL_PATH } from './seat-stage-write.js';
export type {
  PlannedWrite,
  SeatCellConfigDirs,
  SeatCellInput,
  SeatCellReceipt,
  SeatCellReceiptFile,
  SeatCellResult,
  SeatCodexMcpServer,
  SeatEraseResult,
  SeatRecordView,
  SeatStageInput,
  SeatStageInputSeat,
  SeatStageReceipt,
  SeatStageReceiptEntry,
  SeatStageReceiptOnboarding,
  SeatStageResult,
} from './seat-onboarding-types.js';
export { materialiseSeatEnvelopes } from './seat-onboarding-stage1.js';
export { eraseSeatHome } from './seat-onboarding-erase.js';
export { materialiseCellHome } from './seat-onboarding-stage2.js';
