import type { VsCodeBridge } from './vscode-bridge';

export const VSCODE_AUTH_COMMANDS = {
  codexStatus: 'auth.codex.status',
  codexSignIn: 'auth.codex.signIn',
} as const;

export type CodexSignInStatus = {
  connected: boolean;
  accountLabel?: string | null;
  reason?: string;
};

export type CodexSignInResult = {
  opened: boolean;
  url?: string;
};

export interface VsCodeAuthBridge {
  getCodexStatus(): Promise<CodexSignInStatus>;
  openCodexSignIn(): Promise<CodexSignInResult>;
}

export function createVsCodeAuthBridge(bridge: VsCodeBridge): VsCodeAuthBridge {
  return {
    getCodexStatus(): Promise<CodexSignInStatus> {
      return bridge.request<CodexSignInStatus>(VSCODE_AUTH_COMMANDS.codexStatus);
    },
    openCodexSignIn(): Promise<CodexSignInResult> {
      // Codex sign-in is isolated to dev/plugin workflows and must not alter app auth domain.
      return bridge.request<CodexSignInResult>(VSCODE_AUTH_COMMANDS.codexSignIn);
    },
  };
}
