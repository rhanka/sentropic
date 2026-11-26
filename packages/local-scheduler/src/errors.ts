export type LocalTaskRefusalReasonV1 = 'sandbox' | 'allowlist' | 'file-mode' | 'state-dir';

export type LocalSchedulerErrorCode =
  | 'SYSTEMD_USER_UNAVAILABLE'
  | 'INVALID_TASK_SPEC'
  | 'INTERVAL_MISMATCH'
  | 'UNMANAGED_UNIT'
  | 'POLICY_REFUSED_SANDBOX'
  | 'POLICY_REFUSED_ALLOWLIST'
  | 'POLICY_REFUSED_FILE_MODE'
  | 'POLICY_REFUSED_STATE_DIR'
  | 'MANIFEST_CORRUPT'
  | 'TASK_NOT_FOUND'
  | 'SYSTEMCTL_FAILED'
  | 'RUNNER_INTERNAL_ERROR';

/** Base error class carrying a closed error code and process exit code. */
export class LocalSchedulerError extends Error {
  readonly code: LocalSchedulerErrorCode;
  readonly exitCode: 2 | 69 | 70 | 77;

  constructor(
    code: LocalSchedulerErrorCode,
    exitCode: 2 | 69 | 70 | 77,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
    this.exitCode = exitCode;
  }
}
/** Raised when systemd --user is unavailable or unsupported. */
export class SchedulerUnavailableError extends LocalSchedulerError {
  override readonly code = 'SYSTEMD_USER_UNAVAILABLE' as const;
  readonly reason: 'not-linux' | 'no-systemctl' | 'no-user-manager' | 'timeout';
  override readonly exitCode = 69 as const;
  constructor(reason: 'not-linux' | 'no-systemctl' | 'no-user-manager' | 'timeout', message: string, options?: ErrorOptions) {
    super('SYSTEMD_USER_UNAVAILABLE', 69, message, options);
    this.reason = reason;
  }
}
/** Raised when a task specification or calendar interval fails validation. */
export class InvalidTaskSpecError extends LocalSchedulerError {
  override readonly code: 'INVALID_TASK_SPEC' | 'INTERVAL_MISMATCH';
  readonly field?: string;
  override readonly exitCode = 2 as const;
  constructor(code: 'INVALID_TASK_SPEC' | 'INTERVAL_MISMATCH', message: string, field?: string, options?: ErrorOptions) {
    super(code, 2, message, options);
    this.code = code;
    this.field = field;
  }
}

/** Raised when a unit file exists without matching @sentropic/local-scheduler headers. */
export class UnmanagedUnitError extends LocalSchedulerError {
  override readonly code = 'UNMANAGED_UNIT' as const;
  readonly unitPath: string;
  override readonly exitCode = 2 as const;

  constructor(unitPath: string, message: string, options?: ErrorOptions) {
    super('UNMANAGED_UNIT', 2, message, options);
    this.unitPath = unitPath;
  }
}

/** Raised when execution or unit installation violates a security or file-mode policy. */
export class PolicyRefusalError extends LocalSchedulerError {
  override readonly code:
    | 'POLICY_REFUSED_SANDBOX'
    | 'POLICY_REFUSED_ALLOWLIST'
    | 'POLICY_REFUSED_FILE_MODE'
    | 'POLICY_REFUSED_STATE_DIR';
  readonly refusal: LocalTaskRefusalReasonV1;
  override readonly exitCode = 77 as const;

  constructor(
    code:
      | 'POLICY_REFUSED_SANDBOX'
      | 'POLICY_REFUSED_ALLOWLIST'
      | 'POLICY_REFUSED_FILE_MODE'
      | 'POLICY_REFUSED_STATE_DIR',
    refusal: LocalTaskRefusalReasonV1,
    message: string,
    options?: ErrorOptions,
  ) {
    super(code, 77, message, options);
    this.code = code;
    this.refusal = refusal;
  }
}

/** Raised when an existing task manifest fails parsing or schema validation. */
export class ManifestCorruptError extends LocalSchedulerError {
  override readonly code = 'MANIFEST_CORRUPT' as const;
  readonly manifestPath: string;
  override readonly exitCode = 2 as const;

  constructor(manifestPath: string, message: string, options?: ErrorOptions) {
    super('MANIFEST_CORRUPT', 2, message, options);
    this.manifestPath = manifestPath;
  }
}

/** Raised when a requested task manifest does not exist. */
export class TaskNotFoundError extends LocalSchedulerError {
  override readonly code = 'TASK_NOT_FOUND' as const;
  readonly taskId: string;
  override readonly exitCode = 2 as const;

  constructor(taskId: string, message: string, options?: ErrorOptions) {
    super('TASK_NOT_FOUND', 2, message, options);
    this.taskId = taskId;
  }
}

/** Raised when a systemctl lifecycle invocation fails. */
export class SystemctlFailedError extends LocalSchedulerError {
  override readonly code = 'SYSTEMCTL_FAILED' as const;
  readonly command: readonly string[];
  readonly stderr: string;
  readonly rolledBack: boolean;
  override readonly exitCode = 70 as const;

  constructor(
    command: readonly string[],
    stderr: string,
    rolledBack: boolean,
    message: string,
    options?: ErrorOptions,
  ) {
    super('SYSTEMCTL_FAILED', 70, message, options);
    this.command = command;
    this.stderr = stderr;
    this.rolledBack = rolledBack;
  }
}
