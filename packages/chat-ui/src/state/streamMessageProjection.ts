import { asRecord, asTaskList, normalizeTaskStatus } from '@sentropic/chat-runtime/state/streamMessageProjection';


export const needsReasoningSectionBreak = (prev: string, delta: string): boolean => {
  if (!prev) return false;
  if (!delta || !delta.startsWith('**')) return false;
  return !/\s$/.test(prev);
};

export const summarizePreviewText = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) return '';
  if (normalized.length <= 320) return normalized;
  return normalized.slice(-320);
};




export const escapeMarkdownText = (value: string): string =>
  value.replace(/([\\`*_{}\[\]()#+.!|>~-])/g, '\\$1');

export const buildTodoRuntimeChecklist = (
  _toolName: 'plan',
  rawResult: unknown,
): string | null => {
  const result = asRecord(rawResult) ?? {};
  const runtime = asRecord(result.todoRuntime) ?? result;
  const operation = String(runtime.operation ?? '').trim();
  const todo = asRecord(runtime.todo);
  const activeTodo = asRecord(runtime.activeTodo);
  const task = asRecord(runtime.task);

  const todoTitle = String(todo?.title ?? activeTodo?.title ?? '').trim();
  const todoId = String(runtime.todoId ?? todo?.id ?? activeTodo?.id ?? '').trim();
  const headerLabel = todoTitle
    ? `Plan ${todoTitle}`
    : todoId
      ? `Plan ${todoId}`
      : 'Plan';

  const tasksFromRuntime = asTaskList(runtime.tasks);
  const tasksFromResult = asTaskList(result.tasks);
  let taskItems = tasksFromRuntime.length > 0 ? tasksFromRuntime : tasksFromResult;

  if (taskItems.length === 0 && task) {
    const taskTitle = String(task.title ?? '').trim();
    if (taskTitle) {
      taskItems = [
        {
          id: String(task.id ?? '').trim() || undefined,
          title: taskTitle,
          status: normalizeTaskStatus(task.status ?? task.derivedStatus),
        },
      ];
    }
  }

  if (taskItems.length === 0) return null;

  const lines = [headerLabel];
  for (const item of taskItems) {
    const done = normalizeTaskStatus(item.status) === 'done';
    const safeTitle = escapeMarkdownText(item.title);
    lines.push(done ? `- [x] ~~${safeTitle}~~` : `- [ ] ${safeTitle}`);
  }
  if (operation === 'update_task' && taskItems.length === 1) {
    lines.push(`_Task status: ${normalizeTaskStatus(taskItems[0].status)}_`);
  }
  return lines.join('\n');
};
