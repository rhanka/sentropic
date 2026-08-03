import type { DesktopRpcRequest } from './types.js';
import { DesktopRpcServer } from './server.js';

/** Minimal structural seam around the Windows-only CoreWebView2 APIs. */
export type WebView2Shell = {
    setVirtualHostNameToFolderMapping(hostName: string, folderPath: string, accessKind: 'denyCors'): void;
    navigate(url: string): void;
    postWebMessageAsJson(message: unknown): void;
    addWebMessageReceived(listener: (message: unknown) => void): () => void;
    addNavigationStarting(listener: (event: { uri: string; cancel: boolean }) => void): () => void;
    addNewWindowRequested(listener: (event: { cancel: boolean }) => void): () => void;
    addDownloadStarting(listener: (event: { cancel: boolean }) => void): () => void;
    addWebResourceRequested(listener: (event: { uri: string; cancel: boolean }) => void): () => void;
};

export type InstallLocalWebView2ShellInput = {
    webview: WebView2Shell;
    rpcServer: DesktopRpcServer;
    assetDirectory: string;
    hostName?: string;
    entryPath?: string;
};

/**
 * Windows integration layer. The actual host supplies the native CoreWebView2
 * adapter; this policy layer only permits packaged virtual-host assets and the
 * narrow desktop RPC protocol.
 */
export const installLocalWebView2Shell = (input: InstallLocalWebView2ShellInput): (() => void) => {
    const hostName = input.hostName ?? 'cowork.local';
    const origin = `https://${hostName}`;
    const entryPath = input.entryPath ?? '/index.html';
    input.webview.setVirtualHostNameToFolderMapping(hostName, input.assetDirectory, 'denyCors');

    const allowLocal = (uri: string): boolean => {
        try {
            const parsed = new URL(uri);
            return parsed.origin === origin && parsed.protocol === 'https:' && parsed.hostname === hostName;
        } catch {
            return false;
        }
    };
    const removeNavigation = input.webview.addNavigationStarting((event) => {
        if (!allowLocal(event.uri)) event.cancel = true;
    });
    const removeWindow = input.webview.addNewWindowRequested((event) => { event.cancel = true; });
    const removeDownload = input.webview.addDownloadStarting((event) => { event.cancel = true; });
    const removeResource = input.webview.addWebResourceRequested((event) => {
        // Includes scripts, fetches, images and iframes: no remote origin may load.
        if (!allowLocal(event.uri)) event.cancel = true;
    });
    const removeMessage = input.webview.addWebMessageReceived((message) => {
        if (!isRequest(message)) return;
        void input.rpcServer.handle(message, (event) => input.webview.postWebMessageAsJson(event))
            .then((response) => input.webview.postWebMessageAsJson(response));
    });
    input.webview.navigate(`${origin}${entryPath.startsWith('/') ? entryPath : `/${entryPath}`}`);

    return () => {
        removeMessage();
        removeResource();
        removeDownload();
        removeWindow();
        removeNavigation();
        input.rpcServer.disconnect();
    };
};

const isRequest = (value: unknown): value is DesktopRpcRequest => {
    if (!value || typeof value !== 'object') return false;
    const request = value as Partial<DesktopRpcRequest>;
    return request.type === 'desktop_rpc_request' && typeof request.id === 'string' && typeof request.verb === 'string';
};
