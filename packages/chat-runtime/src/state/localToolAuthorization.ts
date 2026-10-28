import type { ConversationPermission } from '@sentropic/chat-ui/conversation';
import { isLocalToolName } from '../stores/localTools.js';
import type { AttachLocalToolMachineOptions, ControllerLocalToolExecutorFn } from './chatLoopController.js';

export type LocalToolAuthorizationRequest = {
  toolCallId: string;
  streamId: string;
  name: string;
  args: unknown;
  decision?: 'allow' | 'deny';
};
export type LocalToolAuthorization = (
  request: LocalToolAuthorizationRequest,
  signal: AbortSignal,
) => boolean | 'pending' | Promise<boolean | 'pending'>;

/** Host authorization is checked before entering any platform executor. */
export function createAuthorizedLocalToolMachine(options: {
  machine?: AttachLocalToolMachineOptions;
  authorize?: LocalToolAuthorization;
  permissionTimeoutMs?: number;
  postResult: AttachLocalToolMachineOptions['postLocalToolResult'];
  onChange(): void;
}) {
  const authorize = options.authorize ?? (() => false);
  const permissions = new Map<string, ConversationPermission>();
  const executions = new Map<string, Promise<unknown>>();
  const posts = new Map<string, Promise<void>>();
  const decisions = new Map<string, { request: LocalToolAuthorizationRequest; resolve(value: boolean): void }>();
  const abort = new AbortController();
  const setStatus = (request: LocalToolAuthorizationRequest, status: ConversationPermission['status']) => {
    if (abort.signal.aborted) return;
    permissions.set(`${request.streamId}:${request.toolCallId}`, {
      id: `${request.streamId}:${request.toolCallId}`, name: request.name, status,
    });
    options.onChange();
  };
  const execute: ControllerLocalToolExecutorFn = (toolCallId, name, args, { streamId }) => {
    const key = `${streamId}:${toolCallId}`;
    const existing = executions.get(key);
    if (existing) return existing;
    const request = { toolCallId, streamId, name, args };
    const pending = (async () => {
      setStatus(request, 'pending');
      let timer: ReturnType<typeof setTimeout> | undefined;
      let allowed = false;
      let cancel: (() => void) | undefined;
      const decision = new Promise<boolean>((resolve) => { decisions.set(key, { request, resolve }); });
      try {
        allowed = await Promise.race([
          Promise.resolve().then(() => options.machine ? authorize(request, abort.signal) : false)
            .then((result) => result === 'pending' ? decision : result),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), options.permissionTimeoutMs ?? 30_000);
            cancel = () => resolve(false);
            abort.signal.addEventListener('abort', cancel, { once: true });
          }),
        ]) === true;
      } catch {
        allowed = false;
      } finally {
        if (timer) clearTimeout(timer);
        if (cancel) abort.signal.removeEventListener('abort', cancel);
        decisions.delete(key);
      }
      if (!allowed || abort.signal.aborted) {
        setStatus(request, 'denied');
        throw new Error('Local tool permission denied');
      }
      setStatus(request, 'approved');
      return options.machine!.executeLocalTool(toolCallId, name, args, { streamId });
    })();
    executions.set(key, pending);
    void pending.catch((error) => {
      if (options.machine?.isLocalToolPermissionRequired(error)) executions.delete(key);
    });
    return pending;
  };
  const machine: AttachLocalToolMachineOptions = {
    isLocalToolName: options.machine?.isLocalToolName ?? isLocalToolName,
    isLocalToolRuntimeAvailable: options.machine?.isLocalToolRuntimeAvailable ?? (() => true),
    isLocalToolPermissionRequired: options.machine?.isLocalToolPermissionRequired ?? (() => false),
    getPermissionRequest: options.machine?.getPermissionRequest ?? (() => ({ requestId: '', toolName: '', origin: '' })),
    decideLocalToolPermission: options.machine?.decideLocalToolPermission ?? (async () => {}),
    executeLocalTool: execute,
    postLocalToolResult(streamId, toolCallId, result) {
      if (abort.signal.aborted) return Promise.resolve();
      const key = `${streamId}:${toolCallId}`;
      const existing = posts.get(key);
      if (existing) return existing;
      const pending = options.postResult(streamId, toolCallId, result).catch((error) => {
        posts.delete(key);
        throw error;
      });
      posts.set(key, pending);
      return pending;
    },
  };
  return {
    machine, snapshot: () => [...permissions.values()], dispose: () => abort.abort(),
    async decide(id: string, allow: boolean) {
      const pending = decisions.get(id);
      if (!pending || abort.signal.aborted) return;
      if (!allow) { pending.resolve(false); return; }
      const result = await authorize({ ...pending.request, decision: 'allow' }, abort.signal);
      if (result !== 'pending') pending.resolve(result === true);
    },
  };
}
