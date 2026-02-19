console.log("extract.js loaded");

// --- Wait for JSZip ---
async function waitForJSZip() {
    return new Promise((resolve, reject) => {
        const maxWait = 5000; // 5 seconds
        const start = Date.now();

        function check() {
            if (window.JSZip) {
                resolve();
            } else if (Date.now() - start > maxWait) {
                reject(new Error("JSZip not loaded"));
            } else {
                setTimeout(check, 50);
            }
        }

        check();
    });
}

// --- Main initialization ---
(async () => {
    try {
        await waitForJSZip();
        console.log("JSZip loaded:", !!window.JSZip);

        if (window.__CHATGPT_EXPORTER__) {
            console.log("Exporter already initialised");
            return;
        }

        window.__CHATGPT_EXPORTER__ = true;

        chrome.runtime.onMessage.addListener((msg) => {
            if (msg.type === "EXPORT") {
                exportAllConversations();
            }
        });

        // Auto-run
        exportAllConversations();

    } catch (err) {
        console.error("JSZip failed to load:", err);
    }
})();

// --- Collect attachments into one ZIP at the end ---
async function downloadAllConversationsAsZip(allConversations, allAttachments) {
    const zip = new JSZip();

    // Save each conversation JSON
    allConversations.forEach((conv, idx) => {
        zip.file(`conversation_${idx + 1}.json`, JSON.stringify(conv, null, 2));
    });

    // Save attachments into "files/" folder
    for (const att of allAttachments) {
        try {
            const res = await fetch(att.url, { credentials: "include" });
            const blob = await res.blob();
            zip.file(`files/${att.filename}`, blob);
            console.log(`Added attachment: ${att.filename}`);
        } catch (err) {
            console.error(`Failed to fetch attachment ${att.filename}:`, err);
        }
    }

    // Optional index.json for reference
    zip.file("index.json", JSON.stringify(allConversations.map((c, i) => ({
        index: i + 1,
        title: c.title,
        url: c.url
    })), null, 2));

    // Generate and download single ZIP
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zipBlob);
    a.download = "chatgpt_export.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);

    console.log("All conversations and attachments exported!");
}

// --- Export a single conversation into memory ---
async function runExportForConversation() {
    await delay(5000);
    const conversation = [];
    const attachments = [];
    const seen = new Set();

    const articles = document.querySelectorAll('#thread article[data-testid^="conversation-turn-"]');

    console.log(`${articles.length} messages found in this conversation`);
    articles.forEach(article => {
        const role = article.getAttribute("data-turn");
        const messageNode = article.querySelector("[data-message-author-role]");
        const content = messageNode?.innerText?.trim() || "";

        console.log(`Role: ${role}, \nContent: ${content}`);


        const msgAttachments = [];
        const imgs = article.querySelectorAll('img[src*="file_"]');

        imgs.forEach(img => {
            if (!img.src || seen.has(img.src)) return;
            seen.add(img.src);

            const filename = `img_${attachments.length}.png`;
            const type =
                img.alt?.includes("Generated") ? "generated-image" :
                img.alt?.includes("Uploaded") ? "uploaded-image" :
                "image";

            const attachment = { type, filename, url: img.src };
            msgAttachments.push(attachment);
            attachments.push(attachment);
        });

        if (content || msgAttachments.length) {
            console.log(`Pushing message ${conversation.length + 1} to conversation`);
            conversation.push({ role, content, attachments: msgAttachments });
        }
    });

    if (!conversation.length) return null;

    return {
        title: document.title || "Conversation",
        url: window.location.href,
        exported_at: new Date().toISOString(),
        conversation,
        attachments
    };
}

// --- Open a conversation and wait for messages ---
async function openConversationAndExport(link) {
    return new Promise((resolve) => {
        const observer = new MutationObserver(async (mutations, obs) => {
            const messages = document.querySelectorAll('[data-message-author-role]');
            if (messages.length > 0) {
                obs.disconnect();
                const convData = await runExportForConversation();
                resolve(convData);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
        link.click();
    });
}

// --- Main batch export ---
async function exportAllConversations() {
    const sidebarLinks = document.querySelectorAll('#history a[data-sidebar-item="true"]');
    const allConversations = [];
    const allAttachments = [];
    let convIndex = 0;

    for (const link of sidebarLinks) {
        convIndex++;
        console.log(`Opening conversation ${convIndex}: ${link.innerText}`);
        const convData = await openConversationAndExport(link);
        if (convData) {
            allConversations.push(convData);
            allAttachments.push(...convData.attachments);
        }
        console.log(`Conversation ${convIndex} exported.`);
        
    }

    // Download single ZIP for all conversations
    await downloadAllConversationsAsZip(allConversations, allAttachments);
}

const delay = ms => new Promise(res => setTimeout(res, ms));



