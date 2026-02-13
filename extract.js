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

            insertExportButton();
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

function createExportButton(){
    const btn = document.createElement("button");
    btn.id = "chatgpt-export-btn";
    btn.innerText = "Export";
    btn.style.marginLeft = "8px";
    btn.style.padding = "6px 12px";
    btn.style.backgroundColor = "#10a37f";
    btn.style.color = "white";
    btn.style.border = "none";
    btn.style.borderRadius = "4px";
    btn.style.cursor = "pointer";
    btn.style.fontSize = "14px";

    // Hover effect
    btn.onmouseover = () => (btn.style.opacity = "0.8");
    btn.onmouseout = () => (btn.style.opacity = "1");

    // Click handler

    btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.innerText = "Exporting...";
        await runExport();
        btn.disabled = false;
        btn.innerText = "Export";
    });

    return btn;
}

function insertExportButton() {
    if (document.getElementById("chatgpt-export-btn")) return;

    const header = document.querySelector('header');
    if (!header) return;

    const btn = createExportButton();
    header.appendChild(btn);
}

insertExportButton();

const observer = new MutationObserver(() => {
    insertExportButton();
});

observer.observe(document.body, { childList: true, subtree: true});
