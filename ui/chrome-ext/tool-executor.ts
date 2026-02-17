type ToolExecutionContext = {
    senderTabId?: number;
    senderWindowId?: number;
};

type ToolExecutor = (
    args: Record<string, unknown>,
    context: ToolExecutionContext,
) => Promise<unknown>;

type ScrollDirection = 'up' | 'down' | 'top' | 'bottom';

const NON_INJECTABLE_URL_PREFIXES = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:',
    'devtools://',
    'view-source:',
];

const canInjectTabUrl = (url: string | undefined): boolean => {
    if (!url) return false;
    return !NON_INJECTABLE_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
};

const resolveTargetTab = async (
    args: Record<string, unknown>,
    context: ToolExecutionContext,
): Promise<chrome.tabs.Tab> => {
    const tabIdFromArgs =
        typeof args.tabId === 'number' && Number.isFinite(args.tabId)
            ? args.tabId
            : null;
    if (tabIdFromArgs !== null) {
        const tab = await chrome.tabs.get(tabIdFromArgs);
        if (!canInjectTabUrl(tab.url)) {
            throw new Error(`Unsupported tab URL for automation: ${tab.url ?? 'unknown'}`);
        }
        return tab;
    }

    if (typeof context.senderTabId === 'number') {
        const tab = await chrome.tabs.get(context.senderTabId);
        if (!canInjectTabUrl(tab.url)) {
            throw new Error(`Unsupported sender tab URL for automation: ${tab.url ?? 'unknown'}`);
        }
        return tab;
    }

    const tabs = await chrome.tabs.query({
        active: true,
        ...(typeof context.senderWindowId === 'number'
            ? { windowId: context.senderWindowId }
            : { currentWindow: true }),
    });
    const tab = tabs[0];
    if (!tab?.id) {
        throw new Error('No active tab found for local tool execution.');
    }
    if (!canInjectTabUrl(tab.url)) {
        throw new Error(`Unsupported active tab URL for automation: ${tab.url ?? 'unknown'}`);
    }
    return tab;
};

const resolveTargetTabId = async (
    args: Record<string, unknown>,
    context: ToolExecutionContext,
): Promise<number> => {
    const tab = await resolveTargetTab(args, context);
    if (typeof tab.id !== 'number') {
        throw new Error('Resolved tab has no id.');
    }
    return tab.id;
};

const executeTabReadDom: ToolExecutor = async (args, context) => {
    const tab = await resolveTargetTab(args, context);
    const tabId = tab.id as number;
    const selector =
        typeof args.selector === 'string' && args.selector.trim().length > 0
            ? args.selector.trim()
            : null;
    const includeHtml = args.includeHtml === true;

    const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (targetSelector: string | null, withHtml: boolean) => {
            const target = targetSelector
                ? document.querySelector(targetSelector)
                : document.body;
            if (!target) {
                return {
                    found: false,
                    selector: targetSelector,
                    text: '',
                    html: withHtml ? '' : undefined,
                };
            }
            return {
                found: true,
                selector: targetSelector,
                text: (target.textContent ?? '').trim().slice(0, 60_000),
                html: withHtml ? (target as HTMLElement).innerHTML.slice(0, 120_000) : undefined,
            };
        },
        args: [selector, includeHtml],
    });

    return {
        url: tab.url ?? null,
        title: tab.title ?? null,
        ...result[0]?.result,
    };
};

const executeTabScreenshot: ToolExecutor = async (args, context) => {
    const tab = await resolveTargetTab(args, context);
    const quality =
        typeof args.quality === 'number' && Number.isFinite(args.quality)
            ? Math.min(100, Math.max(1, Math.round(args.quality)))
            : 80;
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'jpeg',
        quality,
    });
    return {
        format: 'jpeg',
        quality,
        imageDataUrl: dataUrl,
        url: tab.url ?? null,
        title: tab.title ?? null,
    };
};

const executeTabClick: ToolExecutor = async (args, context) => {
    const tabId = await resolveTargetTabId(args, context);
    const selector =
        typeof args.selector === 'string' && args.selector.trim().length > 0
            ? args.selector.trim()
            : null;
    const x = typeof args.x === 'number' && Number.isFinite(args.x) ? args.x : null;
    const y = typeof args.y === 'number' && Number.isFinite(args.y) ? args.y : null;

    const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (targetSelector: string | null, px: number | null, py: number | null) => {
            let element: Element | null = null;
            if (targetSelector) {
                element = document.querySelector(targetSelector);
            } else if (typeof px === 'number' && typeof py === 'number') {
                element = document.elementFromPoint(px, py);
            }

            if (!element) {
                return {
                    clicked: false,
                    reason: `Element not found: ${targetSelector ?? `(${px},${py})`}`,
                };
            }

            (element as HTMLElement).click();
            return {
                clicked: true,
                tag: element.tagName,
                text: ((element as HTMLElement).innerText ?? '').slice(0, 200),
            };
        },
        args: [selector, x, y],
    });

    return result[0]?.result;
};

const executeTabType: ToolExecutor = async (args, context) => {
    const tabId = await resolveTargetTabId(args, context);
    const selector =
        typeof args.selector === 'string' && args.selector.trim().length > 0
            ? args.selector.trim()
            : null;
    const text = typeof args.text === 'string' ? args.text : '';
    const clear = args.clear !== false;
    if (!selector) {
        throw new Error('tab_type requires a selector.');
    }

    const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (targetSelector: string, value: string, shouldClear: boolean) => {
            const node = document.querySelector(targetSelector) as
                | HTMLInputElement
                | HTMLTextAreaElement
                | null;
            if (!node) {
                return { typed: false, reason: `Element not found: ${targetSelector}` };
            }
            if (shouldClear) node.value = '';
            node.focus();
            node.value = `${node.value ?? ''}${value}`;
            node.dispatchEvent(new Event('input', { bubbles: true }));
            node.dispatchEvent(new Event('change', { bubbles: true }));
            return {
                typed: true,
                selector: targetSelector,
                valueLength: node.value.length,
            };
        },
        args: [selector, text, clear],
    });

    return result[0]?.result;
};

const executeTabScroll: ToolExecutor = async (args, context) => {
    const tabId = await resolveTargetTabId(args, context);
    const direction =
        typeof args.direction === 'string' &&
        ['up', 'down', 'top', 'bottom'].includes(args.direction)
            ? (args.direction as ScrollDirection)
            : 'down';
    const pixels =
        typeof args.pixels === 'number' && Number.isFinite(args.pixels)
            ? Math.max(1, Math.round(args.pixels))
            : 500;
    const selector =
        typeof args.selector === 'string' && args.selector.trim().length > 0
            ? args.selector.trim()
            : null;

    const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (targetDirection: ScrollDirection, amount: number, targetSelector: string | null) => {
            const scrollTarget = targetSelector
                ? document.querySelector(targetSelector)
                : null;
            const element = scrollTarget as HTMLElement | null;
            const target: {
                scrollTo: (options: ScrollToOptions) => void;
                scrollBy: (options: ScrollToOptions) => void;
                scrollTop?: number;
                scrollHeight?: number;
            } = element ?? document.scrollingElement ?? document.documentElement;

            if (targetDirection === 'top') {
                target.scrollTo({ top: 0, behavior: 'smooth' });
            } else if (targetDirection === 'bottom') {
                const maxTop = element ? element.scrollHeight ?? 0 : document.documentElement.scrollHeight;
                target.scrollTo({ top: maxTop, behavior: 'smooth' });
            } else if (targetDirection === 'up') {
                target.scrollBy({ top: -amount, behavior: 'smooth' });
            } else {
                target.scrollBy({ top: amount, behavior: 'smooth' });
            }

            return {
                scrolled: true,
                direction: targetDirection,
                pixels: amount,
                selector: targetSelector,
            };
        },
        args: [direction, pixels, selector],
    });

    return result[0]?.result;
};

const executeTabInfo: ToolExecutor = async (args, context) => {
    const tab = await resolveTargetTab(args, context);
    const tabId = tab.id as number;

    const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
            const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
                .slice(0, 20)
                .map((heading) => ({
                    tag: heading.tagName.toLowerCase(),
                    text: (heading.textContent ?? '').trim().slice(0, 300),
                }));
            return {
                url: window.location.href,
                title: document.title,
                linksCount: document.links.length,
                formsCount: document.forms.length,
                headings,
            };
        },
    });

    return {
        tabId,
        url: tab.url ?? null,
        title: tab.title ?? null,
        favIconUrl: tab.favIconUrl ?? null,
        ...(result[0]?.result ?? {}),
    };
};

export const createToolExecutors = (): Record<string, ToolExecutor> => ({
    tab_read_dom: executeTabReadDom,
    tab_screenshot: executeTabScreenshot,
    tab_click: executeTabClick,
    tab_type: executeTabType,
    tab_scroll: executeTabScroll,
    tab_info: executeTabInfo,
});

export type { ToolExecutionContext, ToolExecutor };
