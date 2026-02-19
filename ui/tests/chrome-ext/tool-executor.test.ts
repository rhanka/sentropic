import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolExecutors } from '../../chrome-ext/tool-executor';

type TabsQuery = (queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>;
type TabsGet = (tabId: number) => Promise<chrome.tabs.Tab>;
type CaptureVisibleTab = (
  windowId?: number,
  options?: chrome.tabs.ImageDetails,
) => Promise<string>;
type ExecuteScript = (
  injection: chrome.scripting.ScriptInjection<unknown[]>,
) => Promise<chrome.scripting.InjectionResult[]>;

const setChromeMock = (overrides?: {
  query?: TabsQuery;
  get?: TabsGet;
  captureVisibleTab?: CaptureVisibleTab;
  executeScript?: ExecuteScript;
}) => {
  const query = vi.fn<TabsQuery>(
    overrides?.query ??
      (async () => [])
  );
  const get = vi.fn<TabsGet>(
    overrides?.get ??
      (async () => ({
        id: 1,
        url: 'https://example.com',
        title: 'Example',
        windowId: 1,
      }))
  );
  const captureVisibleTab = vi.fn<CaptureVisibleTab>(
    overrides?.captureVisibleTab ??
      (async () => 'data:image/jpeg;base64,mock')
  );
  const executeScript = vi.fn<ExecuteScript>(
    overrides?.executeScript ??
      (async (injection) => {
        const fn = injection.func as (...args: unknown[]) => unknown;
        const args = (injection.args ?? []) as unknown[];
        return [{ result: fn(...args) }];
      })
  );

  (globalThis as any).chrome = {
    tabs: {
      query,
      get,
      captureVisibleTab,
    },
    scripting: {
      executeScript,
    },
  };

  return {
    query,
    get,
    captureVisibleTab,
    executeScript,
  };
};

describe('tool-executor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete (globalThis as any).chrome;
  });

  it('exposes the expected local tool executors', () => {
    const executors = createToolExecutors();
    expect(Object.keys(executors).sort()).toEqual([
      'tab_action',
      'tab_click',
      'tab_info',
      'tab_read',
      'tab_read_dom',
      'tab_screenshot',
      'tab_scroll',
      'tab_type',
    ]);
  });

  it('falls back to active tab lookup when sender tab is missing (sidepanel-like context)', async () => {
    document.title = 'Fallback doc';
    const { query } = setChromeMock({
      query: async (queryInfo) => {
        if (queryInfo.lastFocusedWindow) {
          return [{
            id: 42,
            url: 'https://fallback.example/path',
            title: 'Fallback',
            windowId: 7,
            favIconUrl: 'https://fallback.example/favicon.ico',
          }];
        }
        return [];
      },
    });

    const executors = createToolExecutors();
    const result = await executors.tab_read({ mode: 'info' }, {});

    expect((result as any).tabId).toBe(42);
    expect((result as any).title).toBe('Fallback doc');
    expect(query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
  });

  it('executes all supported local tools with a valid tabId', async () => {
    document.title = 'Example Page';
    document.body.innerHTML = `
      <main id="content">Hello local tools</main>
      <button id="click-me">Click</button>
      <input id="name-input" />
      <div id="scroll-box"></div>
      <a href="https://example.com/a">A</a>
      <h1>Main title</h1>
    `;

    const button = document.querySelector('#click-me') as HTMLButtonElement;
    const input = document.querySelector('#name-input') as HTMLInputElement;
    const scrollBox = document.querySelector('#scroll-box') as HTMLElement;
    const visibleRect = {
      x: 10,
      y: 10,
      left: 10,
      top: 10,
      right: 130,
      bottom: 42,
      width: 120,
      height: 32,
      toJSON: () => ({}),
    } as DOMRect;
    Object.defineProperty(button, 'getBoundingClientRect', {
      value: () => visibleRect,
      configurable: true,
    });
    (button as any).scrollIntoView = vi.fn();
    const clickSpy = vi.fn();
    button.addEventListener('click', clickSpy);
    (scrollBox as any).scrollBy = vi.fn();
    (scrollBox as any).scrollTo = vi.fn();
    Object.defineProperty(scrollBox, 'scrollHeight', {
      value: 1800,
      configurable: true,
    });

    const { captureVisibleTab } = setChromeMock({
      get: async (tabId) => ({
        id: tabId,
        url: 'https://example.com/page',
        title: 'Example Page',
        windowId: 11,
        favIconUrl: 'https://example.com/favicon.ico',
      }),
      captureVisibleTab: async () => 'data:image/jpeg;base64,abc123',
    });

    const executors = createToolExecutors();

    const info = await executors.tab_read({ tabId: 77, mode: 'info' }, {});
    expect((info as any).title).toBe(document.title);
    expect((info as any).headings?.[0]?.text).toBe('Main title');

    const readDom = await executors.tab_read({ tabId: 77, mode: 'dom' }, {});
    expect((readDom as any).found).toBe(true);
    expect((readDom as any).text).toContain('Hello local tools');

    const elements = await executors.tab_read({
      tabId: 77,
      mode: 'elements',
    }, {});
    expect(Array.isArray((elements as any).clickable)).toBe(true);
    expect(Array.isArray((elements as any).inputs)).toBe(true);

    const action = await executors.tab_action({
      tabId: 77,
      actions: [
        { action: 'click', selector: '#click-me' },
        { action: 'type', selector: '#name-input', text: 'hello', clear: true },
        { action: 'scroll', selector: '#scroll-box', direction: 'down', pixels: 400 },
      ],
    }, {});
    expect((action as any).ok).toBe(true);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('hello');
    expect((scrollBox as any).scrollBy).toHaveBeenCalled();

    const screenshot = await executors.tab_read({
      tabId: 77,
      mode: 'screenshot',
      format: 'jpeg',
      quality: 70,
    }, {});
    expect((screenshot as any).imageDataUrl).toMatch(/^data:image\/jpeg/);
    expect(captureVisibleTab).toHaveBeenCalledWith(11, {
      format: 'jpeg',
      quality: 70,
    });
  });

  it('rejects non-injectable URLs', async () => {
    setChromeMock({
      get: async (tabId) => ({
        id: tabId,
        url: 'chrome://extensions',
        title: 'Extensions',
        windowId: 3,
      }),
    });
    const executors = createToolExecutors();

    await expect(
      executors.tab_read({ tabId: 5, mode: 'dom' }, {})
    ).rejects.toThrow(/Unsupported tab URL/);
  });

  it('returns a clear error when no active injectable tab is found', async () => {
    setChromeMock({
      query: async () => [],
    });
    const executors = createToolExecutors();

    await expect(
      executors.tab_read({ mode: 'info' }, {})
    ).rejects.toThrow(/No active injectable tab found/);
  });
});
