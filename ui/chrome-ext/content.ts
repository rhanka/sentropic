// Top AI Ideas Extension - Content Script
// Bootstraps the ChatWidget inside a Shadow DOM to avoid CSS conflicts.

console.log('Top AI Ideas Content Script loading...');

function bootstrap() {
    if (document.getElementById('top-ai-ideas-ext')) return;

    // Create Shadow DOM container
    const host = document.createElement('div');
    host.id = 'top-ai-ideas-ext';
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0;';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });

    // Inject compiled CSS
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = chrome.runtime.getURL('chatwidget.css');
    shadow.appendChild(style);

    // Mount point
    const mountPoint = document.createElement('div');
    mountPoint.id = 'chat-mount';
    shadow.appendChild(mountPoint);

    // Load the Svelte app
    // We use dynamic import to load the module which contains the Svelte component
    // This module is built as 'chatwidget.js' by Vite
    (async () => {
        try {
            const src = chrome.runtime.getURL('chatwidget.js');
            const module = await import(src);
            const mountFn =
                (module as { mount?: ((target: Element) => void); default?: { mount?: (target: Element) => void } })
                    ?.mount ??
                (module as { default?: { mount?: (target: Element) => void } })?.default?.mount ??
                (globalThis as typeof globalThis & { __topAiIdeasMountChatWidget?: (target: Element) => void })
                    .__topAiIdeasMountChatWidget;

            if (mountFn) {
                mountFn(mountPoint);
                console.log('ChatWidget mounted successfully.');
            } else {
                console.error('ChatWidget module loaded but mount function not found.');
            }
        } catch (err) {
            console.error('Failed to load ChatWidget:', err);
        }
    })();
}

// Initialize when idle/ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}
