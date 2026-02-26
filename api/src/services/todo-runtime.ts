export const TASK_STATUSES = [
  'todo',
  'planned',
  'in_progress',
  'blocked',
  'done',
  'deferred',
  'cancelled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type DerivedAggregateStatus = TaskStatus;

const TASK_STATUS_TRANSITIONS: Readonly<Record<TaskStatus, ReadonlyArray<TaskStatus>>> = {
  todo: ['planned', 'in_progress', 'deferred', 'cancelled'],
  planned: ['in_progress', 'blocked', 'deferred', 'cancelled'],
  in_progress: ['done', 'blocked', 'deferred', 'cancelled'],
  blocked: ['planned', 'in_progress', 'deferred', 'cancelled'],
  deferred: ['planned', 'cancelled'],
  done: [],
  cancelled: [],
};

export function isTaskStatus(value: string): value is TaskStatus {
  return TASK_STATUSES.includes(value as TaskStatus);
}

export function getAllowedTaskStatusTransitions(status: TaskStatus): ReadonlyArray<TaskStatus> {
  return TASK_STATUS_TRANSITIONS[status];
}

export function canTransitionTaskStatus(fromStatus: TaskStatus, toStatus: TaskStatus): boolean {
  if (fromStatus === toStatus) {
    return true;
  }
  return TASK_STATUS_TRANSITIONS[fromStatus].includes(toStatus);
}

export function assertTaskStatusTransition(fromStatus: TaskStatus, toStatus: TaskStatus): void {
  if (!canTransitionTaskStatus(fromStatus, toStatus)) {
    throw new Error(`Invalid task status transition: ${fromStatus} -> ${toStatus}`);
  }
}

export function deriveAggregateStatus(taskStatuses: ReadonlyArray<TaskStatus>): DerivedAggregateStatus {
  if (taskStatuses.length === 0) {
    return 'todo';
  }

  const statuses = new Set(taskStatuses);

  if (statuses.size === 1 && statuses.has('cancelled')) {
    return 'cancelled';
  }
  if (statuses.has('in_progress')) {
    return 'in_progress';
  }
  if (statuses.has('blocked')) {
    return 'blocked';
  }
  if (statuses.has('planned')) {
    return 'planned';
  }
  if (statuses.has('todo')) {
    return 'todo';
  }
  if (statuses.size === 1 && statuses.has('deferred')) {
    return 'deferred';
  }
  if (statuses.has('done')) {
    return 'done';
  }
  if (statuses.has('deferred')) {
    return 'deferred';
  }
  return 'todo';
}

export type TodoPermissionAction =
  | 'todo_edit'
  | 'todo_reassign'
  | 'todo_close'
  | 'task_update'
  | 'task_reassign';

export interface TodoPermissionContext {
  actorUserId: string;
  todoCreatorUserId?: string | null;
  todoOwnerUserId?: string | null;
  taskAssigneeUserId?: string | null;
  isAdmin?: boolean;
}

function isCreator(context: TodoPermissionContext): boolean {
  return Boolean(context.todoCreatorUserId && context.actorUserId === context.todoCreatorUserId);
}

function isOwner(context: TodoPermissionContext): boolean {
  return Boolean(context.todoOwnerUserId && context.actorUserId === context.todoOwnerUserId);
}

function isTaskAssignee(context: TodoPermissionContext): boolean {
  return Boolean(context.taskAssigneeUserId && context.actorUserId === context.taskAssigneeUserId);
}

export function canPerformTodoAction(action: TodoPermissionAction, context: TodoPermissionContext): boolean {
  if (context.isAdmin) {
    return true;
  }

  switch (action) {
    case 'todo_edit':
    case 'todo_reassign':
      return isCreator(context) || isOwner(context);
    case 'todo_close':
      return isOwner(context);
    case 'task_update':
      return isCreator(context) || isOwner(context) || isTaskAssignee(context);
    case 'task_reassign':
      return isCreator(context) || isOwner(context);
    default:
      return false;
  }
}

export const GUARDRAIL_CATEGORIES = ['scope', 'quality', 'safety', 'approval'] as const;
export type GuardrailCategory = (typeof GUARDRAIL_CATEGORIES)[number];
export type GuardrailDecision = 'allow' | 'block' | 'needs_approval';

export interface GuardrailEvaluationInput {
  category: GuardrailCategory;
  violated: boolean;
  isActive?: boolean;
  approvalGranted?: boolean;
}

export function classifyGuardrailDecision(input: GuardrailEvaluationInput): GuardrailDecision {
  if (input.isActive === false || !input.violated) {
    return 'allow';
  }

  if (input.category === 'approval' || input.category === 'quality') {
    return input.approvalGranted ? 'allow' : 'needs_approval';
  }

  return 'block';
}

export const EXECUTION_RUN_MODES = ['manual', 'sub_agentic', 'full_auto'] as const;
export type ExecutionRunMode = (typeof EXECUTION_RUN_MODES)[number];

export const EXECUTION_RUN_STATUSES = [
  'pending',
  'in_progress',
  'paused',
  'completed',
  'failed',
  'cancelled',
  'blocked',
] as const;
export type ExecutionRunStatus = (typeof EXECUTION_RUN_STATUSES)[number];

export interface ExecutionEventDraft {
  runId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  actorType?: string | null;
  actorId?: string | null;
  createdAt?: string;
}

export interface ExecutionEventRecord extends ExecutionEventDraft {
  sequence: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

export function getNextExecutionEventSequence(
  events: ReadonlyArray<ExecutionEventRecord>,
  runId: string,
): number {
  const currentMax = events
    .filter((event) => event.runId === runId)
    .reduce((max, event) => Math.max(max, event.sequence), 0);
  return currentMax + 1;
}

export function appendExecutionEvent(
  events: ReadonlyArray<ExecutionEventRecord>,
  draft: ExecutionEventDraft,
): ExecutionEventRecord {
  return {
    runId: draft.runId,
    eventType: draft.eventType,
    sequence: getNextExecutionEventSequence(events, draft.runId),
    payload: draft.payload ?? {},
    actorType: draft.actorType ?? null,
    actorId: draft.actorId ?? null,
    createdAt: draft.createdAt ?? new Date().toISOString(),
  };
}

export function listExecutionEventsForRun(
  events: ReadonlyArray<ExecutionEventRecord>,
  runId: string,
): ExecutionEventRecord[] {
  return events
    .filter((event) => event.runId === runId)
    .slice()
    .sort((left, right) => left.sequence - right.sequence);
}

const WORKFLOW_PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

function collectStrings(value: unknown, target: string[]): void {
  if (typeof value === 'string') {
    target.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, target);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectStrings(nested, target);
    }
  }
}

export function extractPlaceholdersFromText(text: string): string[] {
  const unique = new Set<string>();
  const matches = text.matchAll(WORKFLOW_PLACEHOLDER_PATTERN);
  for (const match of matches) {
    const token = match[1]?.trim();
    if (token) {
      unique.add(token);
    }
  }
  return [...unique];
}

export interface WorkflowSectionInput {
  sectionKey: string;
  value: unknown;
}

export interface WorkflowSectionPlaceholders {
  sectionKey: string;
  placeholders: string[];
}

export function extractWorkflowSectionPlaceholders(
  sectionKey: string,
  value: unknown,
): WorkflowSectionPlaceholders {
  const strings: string[] = [];
  collectStrings(value, strings);
  const placeholders = new Set<string>();
  for (const textValue of strings) {
    for (const token of extractPlaceholdersFromText(textValue)) {
      placeholders.add(token);
    }
  }

  return {
    sectionKey,
    placeholders: [...placeholders],
  };
}

export function extractWorkflowPlaceholdersBySection(
  sections: ReadonlyArray<WorkflowSectionInput>,
): WorkflowSectionPlaceholders[] {
  return sections.map((section) => extractWorkflowSectionPlaceholders(section.sectionKey, section.value));
}
