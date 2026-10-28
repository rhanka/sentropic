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
  onNativeTimeout(requestId: string): Promise<void>;
}) {
  const authorize = options.authorize ?? (() => false);
  const permissions = new Map<string, ConversationPermission>();
  const executions = new Map<string, Promise<unknown>>();
  const posts = new Map<string, Promise<void>>();
  const grants = new Set<string>();
  const nativeRequests = new Map<string, { request: LocalToolAuthorizationRequest; timer: ReturnType<typeof setTimeout> }>();
  const decisions = new Map<string, { request: LocalToolAuthorizationRequest; resolve(value: boolean): void }>();
  const abort = new AbortController();
  const setStatus = (request: LocalToolAuthorizationRequest, status: ConversationPermission['status']) => {
    if (abort.signal.aborted) return;
    if (status !== 'pending') for (const [id, entry] of permissions) {
      if (entry.status !== 'pending') permissions.delete(id);
    }
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
          Promise.resolve().then(() => grants.has(key) || (options.machine ? authorize(request, abort.signal) : false))
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
      grants.add(key);
      const result = await options.machine!.executeLocalTool(toolCallId, name, args, { streamId });
      setStatus(request, 'approved');
      return result;
    })();
    executions.set(key, pending);
    void pending.catch((error) => {
      if (options.machine?.isLocalToolPermissionRequired(error)) {
        executions.delete(key);
        const requestId = options.machine.getPermissionRequest(error).requestId;
        const timer = setTimeout(() => { void options.onNativeTimeout(requestId); }, options.permissionTimeoutMs ?? 30_000);
        nativeRequests.set(requestId, { request, timer });
      } else setStatus(request, 'denied');
    });
    return pending;
  };
  const machine: AttachLocalToolMachineOptions = {
    isLocalToolName: options.machine?.isLocalToolName ?? isLocalToolName,
    isLocalToolRuntimeAvailable: options.machine?.isLocalToolRuntimeAvailable ?? (() => true),
    isLocalToolPermissionRequired: options.machine?.isLocalToolPermissionRequired ?? (() => false),
    getPermissionRequest: options.machine?.getPermissionRequest ?? (() => ({ requestId: '', toolName: '', origin: '' })),
    async decideLocalToolPermission(requestId, decision) {
      if (abort.signal.aborted) return;
      const native = nativeRequests.get(requestId);
      if (native) clearTimeout(native.timer);
      await options.machine?.decideLocalToolPermission(requestId, decision);
      const request = native?.request;
      nativeRequests.delete(requestId);
      if (request && decision.startsWith('deny')) {
        const key = `${request.streamId}:${request.toolCallId}`;
        grants.delete(key);
        const denied = Promise.reject(new Error('Local tool permission denied'));
        void denied.catch(() => {});
        executions.set(key, denied);
        setStatus(request, 'denied');
      }
    },
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
    machine, snapshot: () => [...permissions.values()],
    dispose() { abort.abort(); for (const entry of nativeRequests.values()) clearTimeout(entry.timer); nativeRequests.clear(); },
    async decide(id: string, allow: boolean) {
      const pending = decisions.get(id);
      if (!pending || abort.signal.aborted) return;
      if (!allow) { pending.resolve(false); return; }
      const result = await authorize({ ...pending.request, decision: 'allow' }, abort.signal);
      if (result !== 'pending') pending.resolve(result === true);
    },
  };
}
