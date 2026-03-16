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

// Listen for download requests for conversation attachments and send url to extract.js
chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
        if (details.url.includes("/backend-api/estuary/content")) {

            console.log("File download request detected:", details.url);

            const tabId = details.tabId;

            if (tabId >= 0) {
                chrome.tabs.sendMessage(tabId, {
                    type: "ATTACHMENT_URL",
                    url: details.url
                });
            }
        }
    },
    { urls: ["https://chatgpt.com/backend-api/estuary/*"] }
);
