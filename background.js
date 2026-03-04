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
                console.log("Injecting JSZIP + extract.js")

                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ["jszip.min.js", "extract.js"]
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

chrome.webRequest.onBeforeRequest.addListener(
    async (details) => {
        if (details.url.includes("/backend-api/estuary/content")) {
            console.log("File download request detected:", details.url);

            const downloadUrl = details.url;
            const filename = details.filename;

            chrome.downloads.download({
                url: downloadUrl,
                filename: filename
            });
        }
    },
    {urls: ["https://chatgpt.com/backend-api/estuary/*"]}
);
