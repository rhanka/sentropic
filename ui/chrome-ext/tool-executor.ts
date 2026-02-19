type ToolExecutionContext = {
    senderTabId?: number;
    senderWindowId?: number;
};

type ToolExecutor = (
    args: Record<string, unknown>,
    context: ToolExecutionContext,
) => Promise<unknown>;

type ScrollDirection = 'up' | 'down' | 'top' | 'bottom';
type TabReadMode = 'info' | 'dom' | 'screenshot' | 'elements';
type TabActionType = 'scroll' | 'click' | 'type' | 'wait';
type TabActionStepInput = {
    action: TabActionType;
    waitMs?: number;
    direction?: ScrollDirection;
    pixels?: number;
    selector?: string;
    text?: string;
    exact?: boolean;
    x?: number;
    y?: number;
    clear?: boolean;
};

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

const dedupeTabsById = (tabs: chrome.tabs.Tab[]): chrome.tabs.Tab[] => {
    const byId = new Map<number, chrome.tabs.Tab>();
    for (const tab of tabs) {
        if (typeof tab.id !== 'number') continue;
        if (!byId.has(tab.id)) byId.set(tab.id, tab);
    }
    return Array.from(byId.values());
};

const findFallbackTargetTab = async (
    context: ToolExecutionContext,
): Promise<chrome.tabs.Tab | null> => {
    const candidates: chrome.tabs.Tab[] = [];

    if (typeof context.senderWindowId === 'number') {
        candidates.push(
            ...(await chrome.tabs.query({
                active: true,
                windowId: context.senderWindowId,
            })),
        );
    }

    candidates.push(
        ...(await chrome.tabs.query({
            active: true,
            lastFocusedWindow: true,
        })),
    );
    candidates.push(
        ...(await chrome.tabs.query({
            active: true,
            currentWindow: true,
        })),
    );
    candidates.push(
        ...(await chrome.tabs.query({
            active: true,
        })),
    );

    for (const tab of dedupeTabsById(candidates)) {
        if (!canInjectTabUrl(tab.url)) continue;
        if (typeof tab.id !== 'number') continue;
        return tab;
    }

    return null;
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

    const fallbackTab = await findFallbackTargetTab(context);
    if (!fallbackTab?.id) {
        throw new Error(
            'No active injectable tab found for local tool execution. ' +
            'Select a normal web page tab or pass args.tabId explicitly.',
        );
    }
    return fallbackTab;
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
    const formatRaw =
        typeof args.format === 'string' ? args.format.trim().toLowerCase() : '';
    const format: 'png' | 'jpeg' =
        formatRaw === 'jpeg' || formatRaw === 'jpg' ? 'jpeg' : 'png';
    const quality =
        typeof args.quality === 'number' && Number.isFinite(args.quality)
            ? Math.min(100, Math.max(1, Math.round(args.quality)))
            : 95;
    const captureOptions: chrome.tabs.CaptureVisibleTabOptions = {
        format,
    };
    if (format === 'jpeg') {
        captureOptions.quality = quality;
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(
        tab.windowId,
        captureOptions,
    );
    return {
        format,
        quality: format === 'jpeg' ? quality : null,
        mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
        imageDataUrl: dataUrl,
        url: tab.url ?? null,
        title: tab.title ?? null,
    };
};

const executeTabElements: ToolExecutor = async (args, context) => {
    const tab = await resolveTargetTab(args, context);
    const tabId = tab.id as number;
    const maxElements =
        typeof args.maxElements === 'number' && Number.isFinite(args.maxElements)
            ? Math.max(1, Math.min(500, Math.round(args.maxElements)))
            : 120;

    const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (maxCount: number) => {
            const isVisible = (node: Element | null): node is HTMLElement => {
                if (!(node instanceof HTMLElement)) return false;
                const style = window.getComputedStyle(node);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
                const rect = node.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            };

            const isClickable = (node: Element | null): node is HTMLElement => {
                if (!(node instanceof HTMLElement)) return false;
                if (node instanceof HTMLButtonElement) return true;
                if (node instanceof HTMLAnchorElement) return true;
                if (node instanceof HTMLInputElement) {
                    return ['button', 'submit', 'checkbox', 'radio'].includes(
                        (node.type || '').toLowerCase(),
                    );
                }
                if (node.getAttribute('role') === 'button') return true;
                if (typeof node.onclick === 'function') return true;
                if (node.tabIndex >= 0) return true;
                return false;
            };

            const isEditable = (node: Element | null): node is HTMLElement => {
                if (!(node instanceof HTMLElement)) return false;
                if (node instanceof HTMLInputElement) return true;
                if (node instanceof HTMLTextAreaElement) return true;
                if (node instanceof HTMLSelectElement) return true;
                if (node.isContentEditable) return true;
                return false;
            };

            const buildSelectorHint = (element: Element): string => {
                if (element.id) {
                    return `#${CSS.escape(element.id)}`;
                }
                const tag = element.tagName.toLowerCase();
                const classNames = Array.from(element.classList)
                    .filter((name) => name.length > 0)
                    .slice(0, 2)
                    .map((name) => `.${CSS.escape(name)}`)
                    .join('');
                const parent = element.parentElement;
                if (!parent) return `${tag}${classNames}`;
                const siblings = Array.from(parent.children).filter(
                    (sibling) => sibling.tagName === element.tagName,
                );
                const index = Math.max(0, siblings.indexOf(element)) + 1;
                return `${tag}${classNames}:nth-of-type(${index})`;
            };

            const labelFor = (element: HTMLElement): string => {
                return [
                    element.innerText ?? '',
                    element.getAttribute('aria-label') ?? '',
                    element.getAttribute('title') ?? '',
                    element.getAttribute('placeholder') ?? '',
                    element.getAttribute('name') ?? '',
                ]
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 300);
            };

            const toBounds = (element: HTMLElement) => {
                const rect = element.getBoundingClientRect();
                return {
                    left: Math.round(rect.left),
                    top: Math.round(rect.top),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                };
            };

            const clickableCandidates = Array.from(
                document.querySelectorAll(
                    'button, a, [role="button"], input[type="button"], input[type="submit"], [onclick], [tabindex]',
                ),
            )
                .filter((node) => isVisible(node) && isClickable(node))
                .slice(0, maxCount);

            const inputCandidates = Array.from(
                document.querySelectorAll(
                    'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
                ),
            )
                .filter((node) => isVisible(node) && isEditable(node))
                .slice(0, maxCount);

            return {
                clickable: clickableCandidates.map((node, index) => {
                    const element = node as HTMLElement;
                    return {
                        index,
                        selector: buildSelectorHint(element),
                        label: labelFor(element),
                        role: element.getAttribute('role') || null,
                        tag: element.tagName.toLowerCase(),
                        bounds: toBounds(element),
                    };
                }),
                inputs: inputCandidates.map((node, index) => {
                    const element = node as HTMLElement;
                    const inputType =
                        element instanceof HTMLInputElement
                            ? element.type || 'text'
                            : element instanceof HTMLTextAreaElement
                                ? 'textarea'
                                : element instanceof HTMLSelectElement
                                    ? 'select'
                                    : 'contenteditable';
                    return {
                        index,
                        selector: buildSelectorHint(element),
                        label: labelFor(element),
                        tag: element.tagName.toLowerCase(),
                        inputType,
                        bounds: toBounds(element),
                    };
                }),
            };
        },
        args: [maxElements],
    });

    return {
        url: tab.url ?? null,
        title: tab.title ?? null,
        ...(result[0]?.result ?? { clickable: [], inputs: [] }),
    };
};

const executeTabClick: ToolExecutor = async (args, context) => {
    const tabId = await resolveTargetTabId(args, context);
    const selector =
        typeof args.selector === 'string' && args.selector.trim().length > 0
            ? args.selector.trim()
            : null;
    const text =
        typeof args.text === 'string' && args.text.trim().length > 0
            ? args.text.trim()
            : null;
    const exact = args.exact === true;
    const x = typeof args.x === 'number' && Number.isFinite(args.x) ? args.x : null;
    const y = typeof args.y === 'number' && Number.isFinite(args.y) ? args.y : null;

    const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (
            targetSelector: string | null,
            targetText: string | null,
            exactText: boolean,
            px: number | null,
            py: number | null,
        ) => {
            const normalize = (value: string): string =>
                value
                    .normalize('NFD')
                    .replace(/\p{Diacritic}/gu, '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toLowerCase();

            const isVisible = (node: Element | null): node is HTMLElement => {
                if (!(node instanceof HTMLElement)) return false;
                const style = window.getComputedStyle(node);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
                const rect = node.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            };

            const isClickable = (node: Element | null): node is HTMLElement => {
                if (!(node instanceof HTMLElement)) return false;
                if (node instanceof HTMLButtonElement) return true;
                if (node instanceof HTMLAnchorElement) return true;
                if (node instanceof HTMLInputElement) {
                    return ['button', 'submit', 'checkbox', 'radio'].includes(
                        (node.type || '').toLowerCase(),
                    );
                }
                if (node.getAttribute('role') === 'button') return true;
                if (typeof node.onclick === 'function') return true;
                if (node.tabIndex >= 0) return true;
                return false;
            };

            const getCandidateLabel = (node: Element): string => {
                const element = node as HTMLElement;
                return [
                    element.innerText ?? '',
                    element.getAttribute('aria-label') ?? '',
                    element.getAttribute('title') ?? '',
                ]
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .trim();
            };

            const clickElement = (node: HTMLElement) => {
                node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
                const rect = node.getBoundingClientRect();
                const clientX = rect.left + rect.width / 2;
                const clientY = rect.top + rect.height / 2;
                const eventInit: MouseEventInit = {
                    bubbles: true,
                    cancelable: true,
                    clientX,
                    clientY,
                };
                node.dispatchEvent(new MouseEvent('mouseover', eventInit));
                node.dispatchEvent(new MouseEvent('mousedown', eventInit));
                node.dispatchEvent(new MouseEvent('mouseup', eventInit));
                node.click();
            };

            const parsePseudoTextSelector = (value: string | null) => {
                if (!value) return { baseSelector: null as string | null, extractedText: null as string | null };
                const containsMatch = value.match(/:(?:contains|has-text)\((['"]?)(.*?)\1\)/i);
                if (!containsMatch) return { baseSelector: value, extractedText: null as string | null };
                const extractedText = containsMatch[2]?.trim() || null;
                const baseSelector = value
                    .replace(/:(?:contains|has-text)\((['"]?)(.*?)\1\)/gi, '')
                    .trim();
                return {
                    baseSelector: baseSelector.length > 0 ? baseSelector : null,
                    extractedText,
                };
            };

            const findByText = (
                rawText: string,
                options?: { exact?: boolean; baseSelector?: string | null },
            ): HTMLElement | null => {
                const normalizedNeedle = normalize(rawText);
                if (!normalizedNeedle) return null;
                const query = options?.baseSelector && options.baseSelector.length > 0
                    ? options.baseSelector
                    : 'button, a, [role="button"], input[type="button"], input[type="submit"], label, [aria-label], [title]';
                let nodes: Element[] = [];
                try {
                    nodes = Array.from(document.querySelectorAll(query)).slice(0, 1200);
                } catch {
                    nodes = Array.from(
                        document.querySelectorAll(
                            'button, a, [role="button"], input[type="button"], input[type="submit"], label, [aria-label], [title]',
                        ),
                    ).slice(0, 1200);
                }

                for (const node of nodes) {
                    if (!isVisible(node) || !isClickable(node)) continue;
                    const label = getCandidateLabel(node);
                    const normalizedLabel = normalize(label);
                    if (!normalizedLabel) continue;
                    if (options?.exact ? normalizedLabel === normalizedNeedle : normalizedLabel.includes(normalizedNeedle)) {
                        return node;
                    }
                }
                return null;
            };

            const getSuggestions = () => {
                const nodes = Array.from(
                    document.querySelectorAll(
                        'button, a, [role="button"], input[type="button"], input[type="submit"], label, [aria-label], [title]',
                    ),
                ).slice(0, 200);
                const labels = nodes
                    .filter((node) => isVisible(node) && isClickable(node))
                    .map((node) => getCandidateLabel(node))
                    .filter((label) => label.length > 0);
                return Array.from(new Set(labels)).slice(0, 8);
            };

            let element: Element | null = null;

            if (targetSelector) {
                const parsedSelector = parsePseudoTextSelector(targetSelector);
                if (parsedSelector.baseSelector) {
                    try {
                        element = document.querySelector(parsedSelector.baseSelector);
                    } catch {
                        element = null;
                    }
                }
                if (!element && parsedSelector.extractedText) {
                    element = findByText(parsedSelector.extractedText, {
                        exact: false,
                        baseSelector: parsedSelector.baseSelector,
                    });
                }
            }

            if (!element && targetText) {
                element = findByText(targetText, { exact: exactText });
            }

            if (!element && typeof px === 'number' && typeof py === 'number') {
                element = document.elementFromPoint(px, py);
            }

            if (!element || !isVisible(element) || !isClickable(element)) {
                const selectorHint = targetSelector ? `selector=${targetSelector}` : null;
                const textHint = targetText ? `text=${targetText}` : null;
                const coordsHint =
                    typeof px === 'number' && typeof py === 'number'
                        ? `coords=(${px},${py})`
                        : null;
                return {
                    clicked: false,
                    reason: `Element not found or not clickable (${[selectorHint, textHint, coordsHint].filter(Boolean).join(' | ') || 'no locator'})`,
                    suggestions: getSuggestions(),
                };
            }

            clickElement(element);
            return {
                clicked: true,
                tag: element.tagName,
                text: getCandidateLabel(element).slice(0, 200),
                via:
                    targetSelector !== null
                        ? 'selector'
                        : targetText !== null
                            ? 'text'
                            : typeof px === 'number' && typeof py === 'number'
                                ? 'coordinates'
                                : 'unknown',
            };
        },
        args: [selector, text, exact, x, y],
    });

    return result[0]?.result;
};

const executeTabType: ToolExecutor = async (args, context) => {
    const tabId = await resolveTargetTabId(args, context);
    const selector =
        typeof args.selector === 'string' && args.selector.trim().length > 0
            ? args.selector.trim()
            : null;
    const x = typeof args.x === 'number' && Number.isFinite(args.x) ? args.x : null;
    const y = typeof args.y === 'number' && Number.isFinite(args.y) ? args.y : null;
    const text = typeof args.text === 'string' ? args.text : '';
    const clear = args.clear !== false;
    if (!text.trim()) {
        return {
            typed: false,
            reason: 'tab_type requires a non-empty text argument.',
            selector,
        };
    }

    const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (
            targetSelector: string | null,
            value: string,
            shouldClear: boolean,
            pointX: number | null,
            pointY: number | null,
        ) => {
            const isInputLike = (
                node: Element | null,
            ): node is HTMLInputElement | HTMLTextAreaElement =>
                node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement;

            const isEditableElement = (node: Element | null): node is HTMLElement => {
                if (!(node instanceof HTMLElement)) return false;
                if (node.isContentEditable) return true;
                return isInputLike(node);
            };

            let node: Element | null = null;
            if (targetSelector) {
                node = document.querySelector(targetSelector);
            } else if (typeof pointX === 'number' && typeof pointY === 'number') {
                node = document.elementFromPoint(pointX, pointY);
            } else {
                node = document.activeElement;
            }

            if (!node) {
                return {
                    typed: false,
                    reason: `No editable target found: ${targetSelector ?? '(active element)'}`,
                    selector: targetSelector,
                };
            }

            if (!isEditableElement(node)) {
                return {
                    typed: false,
                    reason: `Target is not editable: ${node.tagName.toLowerCase()}`,
                    selector: targetSelector,
                };
            }

            node.focus();
            if (isInputLike(node)) {
                if (shouldClear) node.value = '';
                node.value = `${node.value ?? ''}${value}`;
                node.dispatchEvent(new Event('input', { bubbles: true }));
                node.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
                if (shouldClear) node.textContent = '';
                node.textContent = `${node.textContent ?? ''}${value}`;
                node.dispatchEvent(new Event('input', { bubbles: true }));
                node.dispatchEvent(new Event('change', { bubbles: true }));
            }

            return {
                typed: true,
                selector: targetSelector,
                via:
                    targetSelector !== null
                        ? 'selector'
                        : typeof pointX === 'number' && typeof pointY === 'number'
                            ? 'coordinates'
                            : 'activeElement',
                valueLength: value.length,
            };
        },
        args: [selector, text, clear, x, y],
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

const normalizeTabReadMode = (value: unknown): TabReadMode => {
    if (
        typeof value === 'string' &&
        ['info', 'dom', 'screenshot', 'elements'].includes(value)
    ) {
        return value as TabReadMode;
    }
    return 'info';
};

const executeTabRead: ToolExecutor = async (args, context) => {
    const mode = normalizeTabReadMode(args.mode);
    if (mode === 'dom') {
        return executeTabReadDom(args, context);
    }
    if (mode === 'screenshot') {
        return executeTabScreenshot(args, context);
    }
    if (mode === 'elements') {
        return executeTabElements(args, context);
    }
    return executeTabInfo(args, context);
};

const normalizeActionStep = (
    raw: Record<string, unknown>,
): TabActionStepInput | null => {
    const actionRaw = String(raw.action ?? '').trim().toLowerCase();
    if (!['scroll', 'click', 'type', 'wait'].includes(actionRaw)) return null;

    const step: TabActionStepInput = {
        action: actionRaw as TabActionType,
    };

    if (typeof raw.waitMs === 'number' && Number.isFinite(raw.waitMs)) {
        step.waitMs = Math.max(0, Math.round(raw.waitMs));
    }
    if (
        typeof raw.direction === 'string' &&
        ['up', 'down', 'top', 'bottom'].includes(raw.direction)
    ) {
        step.direction = raw.direction as ScrollDirection;
    }
    if (typeof raw.pixels === 'number' && Number.isFinite(raw.pixels)) {
        step.pixels = Math.max(1, Math.round(raw.pixels));
    }
    if (typeof raw.selector === 'string' && raw.selector.trim().length > 0) {
        step.selector = raw.selector.trim();
    }
    if (typeof raw.text === 'string') {
        step.text = raw.text;
    }
    if (raw.exact === true) {
        step.exact = true;
    }
    if (raw.clear === false) {
        step.clear = false;
    }
    if (typeof raw.x === 'number' && Number.isFinite(raw.x)) {
        step.x = raw.x;
    }
    if (typeof raw.y === 'number' && Number.isFinite(raw.y)) {
        step.y = raw.y;
    }

    return step;
};

const wait = async (durationMs: number) =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, durationMs);
    });

const getTabActionStepFailure = (
    step: TabActionStepInput,
    result: unknown,
): string | null => {
    if (!result || typeof result !== 'object') return null;
    const payload = result as Record<string, unknown>;

    if (step.action === 'click' && payload.clicked === false) {
        return typeof payload.reason === 'string'
            ? payload.reason
            : 'tab_action click step did not click any element.';
    }
    if (step.action === 'type' && payload.typed === false) {
        return typeof payload.reason === 'string'
            ? payload.reason
            : 'tab_action type step failed.';
    }
    if (step.action === 'scroll' && payload.scrolled === false) {
        return typeof payload.reason === 'string'
            ? payload.reason
            : 'tab_action scroll step failed.';
    }
    return null;
};

const executeTabAction: ToolExecutor = async (args, context) => {
    const tab = await resolveTargetTab(args, context);
    const tabId = tab.id as number;
    const timeoutMs =
        typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs)
            ? Math.max(1000, Math.min(120_000, Math.round(args.timeoutMs)))
            : 20_000;

    const rawActions = Array.isArray(args.actions)
        ? args.actions
        : typeof args.action === 'string'
            ? [args]
            : [];
    const steps = rawActions
        .map((item) =>
            item && typeof item === 'object'
                ? normalizeActionStep(item as Record<string, unknown>)
                : null,
        )
        .filter((item): item is TabActionStepInput => Boolean(item));

    if (steps.length === 0) {
        throw new Error('tab_action requires at least one action step.');
    }

    const startedAt = Date.now();
    const perStep: Array<{
        index: number;
        action: TabActionType;
        status: 'completed' | 'failed';
        result?: unknown;
        error?: string;
    }> = [];

    for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        if (Date.now() - startedAt > timeoutMs) {
            perStep.push({
                index,
                action: step.action,
                status: 'failed',
                error: `tab_action timeout after ${timeoutMs}ms`,
            });
            break;
        }

        try {
            let result: unknown;
            if (step.action === 'wait') {
                const waitMs = Math.max(0, step.waitMs ?? 0);
                await wait(waitMs);
                result = {
                    waited: true,
                    waitMs,
                };
            } else if (step.action === 'scroll') {
                result = await executeTabScroll(
                    {
                        tabId,
                        direction: step.direction ?? 'down',
                        pixels: step.pixels ?? 500,
                        selector: step.selector,
                    },
                    context,
                );
            } else if (step.action === 'click') {
                result = await executeTabClick(
                    {
                        tabId,
                        selector: step.selector,
                        text: step.text,
                        exact: step.exact,
                        x: step.x,
                        y: step.y,
                    },
                    context,
                );
            } else {
                result = await executeTabType(
                    {
                        tabId,
                        selector: step.selector,
                        text: step.text ?? '',
                        clear: step.clear,
                        x: step.x,
                        y: step.y,
                    },
                    context,
                );
            }

            const stepFailure = getTabActionStepFailure(step, result);
            if (stepFailure) {
                perStep.push({
                    index,
                    action: step.action,
                    status: 'failed',
                    result,
                    error: stepFailure,
                });
                break;
            }

            perStep.push({
                index,
                action: step.action,
                status: 'completed',
                result,
            });

            const interStepWaitMs =
                typeof step.waitMs === 'number' && Number.isFinite(step.waitMs)
                    ? Math.max(0, step.waitMs)
                    : 0;
            if (interStepWaitMs > 0 && step.action !== 'wait') {
                await wait(interStepWaitMs);
            }
        } catch (error) {
            perStep.push({
                index,
                action: step.action,
                status: 'failed',
                error: error instanceof Error ? error.message : String(error),
            });
            break;
        }
    }

    const failedStep = perStep.find((step) => step.status === 'failed') ?? null;
    return {
        ok: failedStep === null,
        timeoutMs,
        durationMs: Date.now() - startedAt,
        totalSteps: steps.length,
        completedSteps: perStep.filter((step) => step.status === 'completed').length,
        failedStepIndex: failedStep?.index ?? null,
        tabId,
        url: tab.url ?? null,
        title: tab.title ?? null,
        steps: perStep,
    };
};

export const createToolExecutors = (): Record<string, ToolExecutor> => ({
    tab_read: executeTabRead,
    tab_action: executeTabAction,
    tab_read_dom: executeTabReadDom,
    tab_screenshot: executeTabScreenshot,
    tab_click: executeTabClick,
    tab_type: executeTabType,
    tab_scroll: executeTabScroll,
    tab_info: executeTabInfo,
});

export type { ToolExecutionContext, ToolExecutor };
