/**
 * BR14a Lot 5 — Chrome extension `LocalToolsAdapter` implementation.
 *
 * Wraps the native `chrome.runtime.sendMessage` API so the
 * @sentropic/chat-ui `stores/localTools` module can post messages to the
 * Chrome extension background service worker without relying on
 * `globalThis.chrome` lookups inside the package fallback path. The
 * fallback continues to work for legacy injection paths; this adapter
 * provides the explicit wiring that Lot 6 will plumb through the
 * SvelteKit upstream bridge entry point.
 *
 * Companion: `ui/src/lib/upstream/injected-script.ts` remains the
 * self-contained IIFE injected into external pages and does not depend
 * on this adapter — it talks directly to the bridge iframe over
 * `window.postMessage`.
 */
import type { LocalToolsAdapter } from '@sentropic/chat-ui/hosts/types';

const RUNTIME_ID_FALLBACK = 'topai.chrome.runtime';

type ChromeRuntimeLike = {
  id?: string;
  sendMessage?: (message: unknown) => Promise<unknown>;
};

type ChromeGlobalLike = typeof globalThis & {
  chrome?: { runtime?: ChromeRuntimeLike };
};

export type CreateChromeLocalToolsAdapterOptions = {
  runtime?: ChromeRuntimeLike | null;
};

const isResponseEnvelope = (
  value: unknown,
): value is Awaited<ReturnType<NonNullable<LocalToolsAdapter['sendMessage']>>> => {
  return Boolean(value) && typeof value === 'object';
};

export const resolveChromeRuntime = (): ChromeRuntimeLike | null => {
  const ext = globalThis as ChromeGlobalLike;
  return ext.chrome?.runtime ?? null;
};

export const createChromeLocalToolsAdapter = (
  options: CreateChromeLocalToolsAdapterOptions = {},
): LocalToolsAdapter => {
  const runtime = options.runtime ?? resolveChromeRuntime();
  const id = runtime?.id ?? RUNTIME_ID_FALLBACK;

  const sendMessage = async (
    message: unknown,
  ): Promise<Awaited<ReturnType<NonNullable<LocalToolsAdapter['sendMessage']>>>> => {
    if (!runtime?.sendMessage) {
      return {
        ok: false,
        error: 'Chrome runtime sendMessage is unavailable.',
      };
    }
    try {
      const raw = await runtime.sendMessage(message);
      if (isResponseEnvelope(raw)) return raw;
      return { ok: false, error: 'Invalid runtime response envelope.' };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  return {
    id,
    sendMessage,
  };
};

export const CHROME_LOCAL_TOOLS_RUNTIME_ID_FALLBACK = RUNTIME_ID_FALLBACK;
