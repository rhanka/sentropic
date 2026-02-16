type ProxyFetchPayload = {
    url: string;
    method: string;
    headers: Record<string, string>;
    bodyText?: string;
};

type ProxyFetchResult =
    | {
        ok: true;
        status: number;
        statusText: string;
        headers: Record<string, string>;
        bodyText: string;
    }
    | {
        ok: false;
        error: string;
    };

let overlayProxyInstalled = false;

const normalizeBaseUrl = (baseUrl: string): URL | null => {
    try {
        return new URL(baseUrl);
    } catch {
        return null;
    }
};

const isApiUrl = (candidate: string, apiBaseUrl: URL): boolean => {
    let target: URL;
    try {
        target = new URL(candidate, window.location.origin);
    } catch {
        return false;
    }
    const targetPath = target.pathname;
    const basePath = apiBaseUrl.pathname.endsWith('/')
        ? apiBaseUrl.pathname.slice(0, -1)
        : apiBaseUrl.pathname;
    return target.origin === apiBaseUrl.origin && targetPath.startsWith(basePath);
};

const requestToPayload = async (request: Request): Promise<ProxyFetchPayload> => {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
        headers[key] = value;
    });

    const method = request.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD') {
        return {
            url: request.url,
            method,
            headers,
        };
    }

    let bodyText: string | undefined;
    try {
        bodyText = await request.text();
    } catch {
        bodyText = undefined;
    }

    return {
        url: request.url,
        method,
        headers,
        bodyText,
    };
};

export const installOverlayFetchProxy = (apiBaseUrlRaw: string) => {
    if (overlayProxyInstalled) return;
    if (typeof window === 'undefined') return;
    if (!chrome?.runtime?.sendMessage) return;

    const apiBaseUrl = normalizeBaseUrl(apiBaseUrlRaw);
    if (!apiBaseUrl) {
        console.warn('Overlay fetch proxy skipped: invalid API base URL.', apiBaseUrlRaw);
        return;
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const request = new Request(input, init);
        if (!isApiUrl(request.url, apiBaseUrl)) {
            return originalFetch(request);
        }

        const payload = await requestToPayload(request);
        const response = await chrome.runtime.sendMessage({
            type: 'proxy_api_fetch',
            payload,
        }) as ProxyFetchResult | undefined;

        if (!response?.ok) {
            const reason = response?.error ?? 'Unknown proxy fetch failure';
            throw new TypeError(reason);
        }

        return new Response(response.bodyText, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        });
    };

    overlayProxyInstalled = true;
};

