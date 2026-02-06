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

// async function exportAttachments(attachments) {
    

//     const zip = new JSZip();
    

//     // Add each file
//     for (const att of attachments) {
//         try {
//             const res = await fetch(att.url, { credentials: "include" });
//             if (!res.ok) throw new Error('Failed: ${att.url}');
//             const blob = await res.blob();
//             zip.file('files/$att.filename}', blob);

//         } catch (err) {
//             console.error("Error downloading ${att.filename}:", err);
//         }
//     }

//     const zipBlob = await zip.generateAsync({ type: 'blob' });
//     const a = document.createElement("a");
//     a.href = URL.createObjectURL(zipBlob);
//     a.download = "chatgpt_export.zip";
//     a.click();
// }

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

    // Prepare JSON references
    const jsonref = attachments.map(att => ({
        type: att.type,
        filename: att.filename, 
        path: 'files/${att.filename}'
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

    const nodes = document.querySelectorAll('[data-message-author-role]');
    const messages = [];
    const allAttachments = [];

    nodes.forEach((node) => {
        const role = node.getAttribute("data-message-author-role");
        const content = node.innerText.trim();

        const attachments = [];

        // Extract Images
        node.querySelectorAll("img").forEach((img) => {
            const src = img.src;
            if (!src) return;

            if (src.includes("chatgpt.com/backend-api/estuary/content")) {
                const filename = img.alt?.trim() || 'img_${allAttachments.length}.png';
                const attachment = {
                    type: "image",
                    filename,
                    url: src
                };

                attachments.push(attachment);
                allAttachments.push(attachment); // add to global list
            }
        });

        if (content || attachments.length) {
            messages.push({ role, content, attachments });
        }
    });

    if (!messages.length) {
        console.warn("No messages found");
        return;
    }

    
    // Export JSON of conversation
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

    // Export attachments as zip
    downloadAttachmentsToZip(allAttachments);
}
