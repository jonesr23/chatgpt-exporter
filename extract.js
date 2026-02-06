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

async function exportAttachments(attachments) {
    // Prepare JSON references
    const jsonref = attachments.map(att => ({
        type: att.type,
        filename: att.filename, 
        path: 'files/${att.filename}'
    }));

    const zip = new JSZip();
    zip.file("attacments.json", JSON.stringify(jsonref, null, 2));

    // Add each file
    for (const att of attachments) {
        try {
            const res = await fetch(att.url, { credentials: "include" });
            if (!res.ok) throw new Error('Failed: ${att.url}');
            const blob = await res.blob();
            zip.file('files/$att.filename}', blob);

        } catch (err) {
            console.error("Error downloading ${att.filename}:", err);
        }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zipBlob);
    a.download = "chatgpt_export.zip";
    a.click();
}

async function downloadAttachmentsToZip(attachments) {
    const zip = new JSZip();

    for (const att of attachments) {
        try {
            const res = await fetch(att.url, { credentials: "include" });
            if (!res.ok) throw new Error('Failed to fetch ${att.url}');

            const blob = await res.blob();
            zip.file(att.filename, blob); //add to zip
            console.log('Added: ${att.filename}');
        
        } catch (err) {
            console.error("Error downloading ${att.filename}:", err);
        }
    }

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
