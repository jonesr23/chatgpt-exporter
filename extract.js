console.log ("extract.js loaded");

async function waitForJSZip() {
    return new Promise((resolve, reject) => {
        const maxWait = 5000; // 5 second timeout
        const start = Date.now();

        function check(){
            if (window.JSZip) {
                resolve();

            } else if (Date.now - start > maxWait) {
                reject(new Error("JSZip not loaded"));

            } else {
                setTimeout(check, 50);
            }
        }

        check();
    });
    
}

(async () => {
    try {
        await waitForJSZip();

        console.log("JSZip loaded: ", !!window.JSZip);

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

    } catch (err) {
        console.error("JSZip failed to load:", err);
    }
})();





async function downloadAttachmentsToZip(attachments) {
    
    const zip = new JSZip();

    for (const att of attachments) {
        try {
            const res = await fetch(att.url, { credentials: "include" });
            if (!res.ok) throw new Error(`Failed to fetch ${att.url}`);

            const blob = await res.blob();
            zip.file(att.filename, blob); //add to zip
            console.log(`Added: ${att.filename}`);
        
        } catch (err) {
            console.error(`Error downloading ${att.filename}:`, err);
        }
    }

    // Prepare JSON references
    const jsonref = attachments.map(att => ({
        type: att.type,
        filename: att.filename, 
        path: `files/${att.filename}`
    }));

    zip.file("attachments.json", JSON.stringify(jsonref, null, 2));

    // Generate zip as blob
    const zipBlob = await zip.generateAsync({ type: "blob"});

    //Donwload the zip

    const a = document.createElement("a");
    a.href = URL.createObjectURL(zipBlob);
    a.download = "chatgpt_attachments.zip";
    a.click();
}

function runExport() {
    console.log("Running Export");

    const conversation = [];
    const allAttachments = [];
    const seen = new Set();

    const articles = document.querySelectorAll(
        '#thread article[data-testid^="conversation-turn-"]'
    );

    console.log(articles.length);

    articles.forEach(article => {
        const role = article.getAttribute("data-turn");
        const messageNode = article.querySelector("[data-message-author-role]");
        const content = messageNode?.innerText?.trim() || "";
        const files = extractFilesFromMessage(messageNode);
        console.log(files);
        const attachments = [];

        //Extract images from message

        const imgs = article.querySelectorAll(
            'img[src*="chatgpt.com/backend-api/estuary/content"]'
        );

        imgs.forEach(img => {
            const src = img.src;
            if (!src || seen.has(src)) return;

            seen.add(src);

            const type = 
                img.alt?.includes("Generated") ? "generated-image" :
                img.alt?.includes("Uploaded") ? "uploaded-image" :
                "image";

            const filename = `img_${allAttachments.length}.png`;
            const attachment = {
                type,
                filename,
                url: src
            };

            attachments.push(attachment);
            allAttachments.push(attachment);
    });

    if (content || attachments.length) {
        conversation.push({
            role,
            content,
            attachments
        });
    }
});




    if (!conversation.length) {
        console.warn("No messages found");
        return;
    }

    
    // Export JSON of conversation
    const payload = {
        source: "chatgpt.com",
        url: window.location.href,
        exported_at: new Date().toISOString(),
        conversation
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

    // Export attachments as zip
    downloadAttachmentsToZip(allAttachments);
}

function extractFilesFromMessage(messageNode) {
    const fileTiles = messageNode.querySelectorAll('div[class*="group/file-tile"]');
    const files = [];
    fileTiles.forEach(tile => {
        const nameEl = tile.querySelector('div.truncate.font-semibold');
        const typeEl = tile.querySelector('div.truncate.text-token-text-secondary');
        const fileName = nameEl?.textContent.trim();
        const fileType = typeEl?.textContent.trim();

        const downloadButton = tile.querySelector('button[aria-label]');
        const downloadUrl = downloadButton?.getAttribute('data-download-url') || null;

        if (fileName) {
            files.push({ 
                type: fileType, 
                url: downloadUrl,
                filename: fileName
            });
        }

    });
    return files;
}
