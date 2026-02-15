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

    // Fallback skeleton for Lot 3:
    // avoid dynamic module import here because some Chrome versions reject
    // unpacked extensions when content scripts use module loading patterns.
    renderSkeletonWidget(mountPoint);
}

// Initialize when idle/ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}

function renderSkeletonWidget(target: HTMLElement) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'font-family: system-ui, sans-serif; position: fixed; right: 16px; bottom: 16px;';

    const panel = document.createElement('div');
    panel.style.cssText =
        'display: none; width: 320px; max-height: 60vh; margin-bottom: 8px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 12px 30px rgba(15,23,42,0.2); overflow: hidden;';

    const panelHeader = document.createElement('div');
    panelHeader.style.cssText =
        'display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: #0f172a; color: #ffffff; font-size: 13px; font-weight: 600;';
    panelHeader.textContent = 'Top AI Ideas Assistant';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'x';
    closeBtn.style.cssText =
        'all: unset; cursor: pointer; color: #ffffff; font-size: 18px; line-height: 1; padding: 0 4px;';
    closeBtn.addEventListener('click', () => {
        panel.style.display = 'none';
    });
    panelHeader.appendChild(closeBtn);

    const body = document.createElement('div');
    body.style.cssText = 'padding: 12px; color: #334155; font-size: 13px; line-height: 1.4;';
    body.textContent =
        'Extension skeleton loaded. ChatWidget integration is handled in the next lot with local tools wiring.';

    panel.appendChild(panelHeader);
    panel.appendChild(body);

    const bubble = document.createElement('button');
    bubble.type = 'button';
    bubble.setAttribute('aria-label', 'Open Top AI Ideas Assistant');
    bubble.textContent = 'AI';
    bubble.style.cssText =
        'all: unset; width: 52px; height: 52px; border-radius: 999px; background: #2563eb; color: #ffffff; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; cursor: pointer; box-shadow: 0 10px 24px rgba(37,99,235,0.45);';
    bubble.addEventListener('click', () => {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    wrapper.appendChild(panel);
    wrapper.appendChild(bubble);
    target.appendChild(wrapper);
}
