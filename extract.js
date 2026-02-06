console.log ("extract.js loaded");

//Prevent double-registration if Chrome reinjects
if (window.__CHATGPT_EXPORTER__) {
    console.log("Exporter already initialised");
} else {
    window.__CHATGPT_EXPORTER__ = true;

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === "EXPORT") {
            runExport();
        }
    });

    //Auto-run on first inject

    runExport();
}

function runExport() {
    console.log("Running Export");

    const nodes = document.querySelectorAll('[data-message-author-role]');
    const messages = [];

    nodes.forEach((node) => {
        const role = node.getAttribute("data-message-author-role");
        const content = node.innerText.trim();

        const attachments = [];

        node.querySelectorAll("img").forEach((img) => {
            const src = img.src;
            if (!src) return;

            if (src.includes("chatgpt.com/backend-api/estuary/content")) {
                attachments.push({
                    type: "image",
                    filename:
                    img.alt?.trim() ||
                    'image_${attachments.length}.png',
                    url: src
                })
            }
        });

        if (content) {
            messages.push({ role, content, attachments });
        }
    });

    if (!messages.length) {
        console.warn("No messages found");
        return;
    }
    
    const payload = {
        source: "chatgpt.com",
        url: window.location.href,
        exported_at: new Date().toISOString(),
        messages
    };

    const blob = new Blob(
        [JSON.stringify(payload, null, 2)],
        { type: "application/json"}
    );

    const url = URL.createObjectURL(blob);

    chrome.runtime.sendMessage({
        type: "DOWNLOAD",
        url,
        filename: "chatgpt-export.json"
    });

    //Cleanup

    setTimeout(() => URL.revokeObjectURL(url), 1000);
}