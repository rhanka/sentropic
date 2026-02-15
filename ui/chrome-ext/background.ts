// Service Worker for Top AI Ideas Extension

// Tool executor registry placeholder
const toolExecutors: Record<string, (args: any) => Promise<unknown>> = {
    // 'tab_read_dom': executeTabReadDom,
    // ...
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
