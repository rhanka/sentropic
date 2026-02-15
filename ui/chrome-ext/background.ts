// Service Worker for Top AI Ideas Extension

// Tool executor registry placeholder
const toolExecutors: Record<string, (args: any) => Promise<unknown>> = {
    // 'tab_read_dom': executeTabReadDom,
    // ...
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'open_side_panel') {
        const tabId = sender.tab?.id;
        const windowId = sender.tab?.windowId;

        if (typeof tabId !== 'number' || typeof windowId !== 'number') {
            sendResponse({ error: 'Missing sender tab context for side panel opening.' });
            return true;
        }

        void (async () => {
            try {
                await chrome.sidePanel.setOptions({
                    tabId,
                    path: 'chrome-ext/sidepanel.html',
                    enabled: true,
                });
                await chrome.sidePanel.open({
                    tabId,
                    windowId,
                });
                sendResponse({ ok: true });
            } catch (error) {
                sendResponse({
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        })();

        return true;
    }

    if (message.type === 'tool_execute') {
        console.log('Received tool execution request:', message);
        const executor = toolExecutors[message.name];
        if (!executor) {
            sendResponse({ error: `Unknown local tool: ${message.name}` });
            return true;
        }
        executor(message.args)
            .then(result => sendResponse({ result }))
            .catch(err => sendResponse({ error: err.message }));
        return true; // async response
    }
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));
