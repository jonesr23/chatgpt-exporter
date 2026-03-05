console.log("extract.js loaded");

// --- Main initialization ---
(async () => {
  

    try {
        // await waitForJSZip();
        // console.log("JSZip loaded:", !!window.JSZip);

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

        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            if (msg.type === "ATTACHMENT_URL") {
                console.log("Received attachment URL from background:", msg.url);

                // Store it
                window.__EXPORTED_ATTACHMENT_URLS__ ??= [];
                window.__EXPORTED_ATTACHMENT_URLS__.push(msg.url);
            }
        });

        // Auto-run
        exportAllConversations();

    } catch (err) {
        console.error("JSZip failed to load:", err);
    }
})();

// // --- Wait for JSZip ---
// async function waitForJSZip() {
//     return new Promise((resolve, reject) => {
//         const maxWait = 5000; // 5 seconds
//         const start = Date.now();

//         function check() {
//             if (window.JSZip) {
//                 resolve();
//             } else if (Date.now() - start > maxWait) {
//                 reject(new Error("JSZip not loaded"));
//             } else {
//                 setTimeout(check, 50);
//             }
//         }

//         check();
//     });
// }

// // --- Collect attachments into one ZIP at the end ---
// async function downloadAllConversationsAsZip(allConversations, allAttachments) {
//     const zip = new JSZip();

//     // Save each conversation JSON
//     allConversations.forEach((conv, idx) => {
//         zip.file(`conversation_${idx + 1}.json`, JSON.stringify(conv, null, 2));
//     });

//     // Save attachments into "files/" folder
//     for (const att of allAttachments) {
//         try {
//             const res = await fetch(att.url, { credentials: "include" });
//             const blob = await res.blob();
//             zip.file(`files/${att.filename}`, blob);
//             console.log(`Added attachment: ${att.filename}`);
//         } catch (err) {
//             console.error(`Failed to fetch attachment ${att.filename}:`, err);
//         }
//     }

//     // Optional index.json for reference
//     zip.file("index.json", JSON.stringify(allConversations.map((c, i) => ({
//         index: i + 1,
//         title: c.title,
//         url: c.url
//     })), null, 2));

//     // Generate and download single ZIP
//     const zipBlob = await zip.generateAsync({ type: "blob" });
//     const a = document.createElement("a");
//     a.href = URL.createObjectURL(zipBlob);
//     a.download = "chatgpt_export.zip";
//     a.click();
//     setTimeout(() => URL.revokeObjectURL(a.href), 1000);

//     console.log("All conversations and attachments exported!");
// }

async function transferToBridge(allConversations, allAttachments) {
    console.log("Starting secure transfer...");

    const llmURL = "http://localhost:3000"

    // Normalise conversations for transfer, to enable readability for LLM upload
    const normalised = normaliseConversations(allConversations);

    // Opens session with LLM server
    const { sessionId, uploadToken} = await startBridgeSession(llmURL);

    // Upload all attachments to LLM server
    await uploadAttachments(sessionId, uploadToken, allAttachments, llmURL);

    // Upload all conversations individually to LLM server
    for (const conv of normalised) {
        await uploadConversation(sessionId, uploadToken, conv, llmURL);
    }

    

    console.log("Transfer complete.");

    // Cleanup to ensure zero-retention
    allConversations.length = 0;
    allAttachments.length = 0;
}

function normaliseConversations(allConversations){

    // Format conversations to be readable at LLM-side of bridge
    return allConversations.map(conv => ({
        title: conv.title,
        source: "chatgpt",
        exported_at: conv.exported_at,
        messages: conv.conversation.map(msg => ({
            role: msg.role,
            content: msg.content,
            attachments: msg.attachments.map(a => ({
                filename: a.filename,
                type: a.type
            })) || []
        })),
        attachments: conv.attachments
    }));
}

async function startBridgeSession(llmURL) {
    // POST message to LLM server to start upload session
    const res = await fetch(`${llmURL}/session/start` , {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        }
    });

    if (!res.ok) throw new Error("Session start failed");

    return res.json();
    // Expects { sessionId, uploadToken}
}

async function uploadConversation(sessionId, token, conversation, llmURL) {
    // POST message to LLM server to upload a single conversation
    const res = await fetch(`${llmURL}/upload`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            sessionId,
            conversation
        })
    });

    if (!res.ok) throw new Error("Conversation upload failed");
    
    const data = await res.json();
    // Will output a response from the LLM based on prompt given at server-side and uploaded conversation
    //console.log(data.llmResponse);
}

async function uploadAttachments(sessionId, token, attachments, llmURL) {
    
    // Loop through all attachments and upload individually
    for (const att of attachments) {
        console.log("Uploading file: ", att.filename);
        try{
            const res = await fetch(att.url, { credentials: "include"});
            const blob = await res.blob();

            // Create form for file upload
            const formData = new FormData();
            formData.append("sessionId", sessionId);
            formData.append("file", blob, att.filename);

            // POST message to LLM server to upload a single attachment
            await fetch(`${llmURL}/upload/files`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`
                },
                body: formData
            });
        } catch (err) {
            console.error("Attachment upload failed:", err);
        }
    }
}

// --- Export a single conversation into memory ---
async function runExportForConversation() {

    // Delay function
    const delay = ms => new Promise(res => setTimeout(res, ms));

    // Delay to ensure page is loaded
    await delay(5000);
    const conversation = [];
    const attachments = [];
    const seen = new Set();

    // Break down webpage html into articles (conversation messages)
    const articles = document.querySelectorAll('#thread article[data-testid^="conversation-turn-"]');
    const buttonsToClick = [];

    console.log(`${articles.length} messages found in this conversation`);
    // For each message...
    articles.forEach(async article => {
        // Who sent message (assistant || user )
        const role = article.getAttribute("data-turn");
        // Get contents of the message
        const messageNode = article.querySelector("[data-message-author-role]");
        const content = messageNode?.innerText?.trim() || "";

        // Look for attachments to message
        const msgAttachments = [];
        // Image File query
        const imgs = article.querySelectorAll('img[src*="file_"]');
        // Other File Types are accessed through buttons running network fetches
        const buttons = article.querySelectorAll(`
            button[class*="behavior-btn"],
            button[class*="interactive-bg-secondary"],
            button[class*="interactive-label-secondary"]
        `);

        console.log(`${buttons.length} buttons in this message!`);

        // Add all buttons to a list to be clicked after conversation analysis
        buttons.forEach(button => {
            buttonsToClick.push(button);
        });
        
        imgs.forEach(img => {
            // Ensure images are not repeatedly uploaded
            if (!img.src || seen.has(img.src)) return;
            seen.add(img.src);
            // Generate ID for file
            const uuid = window.crypto.randomUUID();

            const filename = uuid;
            // Get whether files were generated by LLM or uploaded or generic
            const type =
                img.alt?.includes("Generated") ? "generated-image" :
                img.alt?.includes("Uploaded") ? "uploaded-image" :
                "image";

            const attachment = { type, filename, url: img.src };
            // Add attachment to message
            msgAttachments.push(attachment);
            // Add attachment to conversation
            attachments.push(attachment);
            console.log(`Role: ${role}, \nContent: ${content}, \nAttachments: ${attachment.filename}`);
        });

        // GOT TO HERE

        if (content || msgAttachments.length) {
            console.log(`Pushing message ${conversation.length + 1} to conversation`);
            conversation.push({ role, content, attachments: msgAttachments });
        }
    });

    console.log("Total Buttons:", buttonsToClick.length);
    for (const button of buttonsToClick) {

        const waitPromise = waitForAttachment();

        button.click();

        // Wait 5 seconds to catch url and return null if not caught in time
        const url = Promise.race([
            waitPromise,
            delay(5000).then(() => null)
        ]);
    }

    const urls = window.__EXPORTED_ATTACHMENT_URLS__ || [];
    console.log(urls.length);
    for (const url of urls) {
        const uuid = window.crypto.randomUUID();

        const filename = uuid;
        const attachment = fetchAndStoreFile(url, filename);
        attachments.push(attachment);
        console.log(`${filename} stored`);

    }

    window.__EXPORTED_ATTACHMENT_URLS__ = [];


    if (!conversation.length) return null;

    return {
        title: document.title || "Conversation",
        url: window.location.href,
        exported_at: new Date().toISOString(),
        conversation,
        attachments
    };
}

function waitForAttachment() {
    return new Promise(resolve => {
        function listener(msg) {
            if (msg.type === "ATTACHMENT_URL") {
                chrome.runtime.onMessage.removeListener(listener);
                resolve(msg.url);
            }
        }
        chrome.runtime.onMessage.addListener(listener);
    });
}

async function fetchAndStoreFile(url, filename) {
    try {
        const res = await fetch(url, {
            credentials: "include"
        });

        if (!res.ok) {
            throw new Error(`Fetch failed: ${res.status}`);
        }

        const blob = await res.blob();

        return {
            filename,
            blob,
            size: blob.size,
            type: blob.type
        };

    } catch (err) {
        console.error("File fetch failed:", err);
        return null;
    }
}

// function waitForModalAndClose() {
//     return new Promise((resolve) => {
//         const observer = new MutationObserver(() => {
//             const modal = document.querySelector('[role="dialog"]');
//             if (!modal) return;

//             const closeBtn =
//                 modal.querySelector('button[aria-label="Close"]') ||
//                 modal.querySelector('button');

//             if (closeBtn){
//                 closeBtn.click();
//             } else {
//                 modal.remove();
//             }

//         });

//         observer.observe(document.body, {
//             childList: true,
//             subtree: true,
//         });
//     });
// }

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
    // await downloadAllConversationsAsZip(allConversations, allAttachments);
    await transferToBridge(allConversations, allAttachments);


}



