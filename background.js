console.log("Background loaded");
chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;

    // Try to trigger export in existing content script

    chrome.tabs.sendMessage(
        tab.id,
        { type: "EXPORT" },
        async () => {
            if (chrome.runtime.lastError) {
                // Content script not injected yet - inject it
                console.log("Injecting extract.js")

                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ["extract.js"]
                });
            }
        }
    );
});

// Handle download requests
chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "DOWNLOAD") return;

    chrome.downloads.download({
        url: msg.url,
        filename: msg.filename,
        saveAs: true
    });
});
