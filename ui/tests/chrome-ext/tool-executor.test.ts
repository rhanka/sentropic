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
      'tab_click',
      'tab_info',
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
    const result = await executors.tab_info({}, {});

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

    const info = await executors.tab_info({ tabId: 77 }, {});
    expect((info as any).title).toBe(document.title);
    expect((info as any).headings?.[0]?.text).toBe('Main title');

    const readDom = await executors.tab_read_dom({ tabId: 77 }, {});
    expect((readDom as any).found).toBe(true);
    expect((readDom as any).text).toContain('Hello local tools');

    const click = await executors.tab_click({
      tabId: 77,
      selector: '#click-me',
    }, {});
    expect((click as any).clicked).toBe(true);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const type = await executors.tab_type({
      tabId: 77,
      selector: '#name-input',
      text: 'hello',
    }, {});
    expect((type as any).typed).toBe(true);
    expect(input.value).toBe('hello');

    const scroll = await executors.tab_scroll({
      tabId: 77,
      selector: '#scroll-box',
      direction: 'down',
      pixels: 400,
    }, {});
    expect((scroll as any).scrolled).toBe(true);
    expect((scrollBox as any).scrollBy).toHaveBeenCalled();

    const screenshot = await executors.tab_screenshot({
      tabId: 77,
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
      executors.tab_read_dom({ tabId: 5 }, {})
    ).rejects.toThrow(/Unsupported tab URL/);
  });

  it('returns a clear error when no active injectable tab is found', async () => {
    setChromeMock({
      query: async () => [],
    });
    const executors = createToolExecutors();

    await expect(
      executors.tab_info({}, {})
    ).rejects.toThrow(/No active injectable tab found/);
  });
});
