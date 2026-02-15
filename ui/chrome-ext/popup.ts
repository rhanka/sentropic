console.log('Popup script loaded');
// Placeholder for popup logic
const app = document.getElementById('app');
if (app) {
    app.innerHTML = '<p>Extension is active.</p><button id="open-sidepanel">Open Side Panel</button>';
    document.getElementById('open-sidepanel')?.addEventListener('click', () => {
        // Open side panel logic could go here if supported by API from popup
        // chrome.sidePanel.open({ windowId: ... }) requires user action
        window.close();
    });
}
