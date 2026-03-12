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
        insertExportButton();

    } catch (err) {
        console.error("JSZip failed to load:", err);
    }
})();

async function promptServerURL() {
    const current = await getServerURL();

    const url = prompt("Enter LLM server URL:", current);

    if (!url) return;

    try {
        new URL(url); // validate
        await setServerURL(url);
        alert("Server URL saved.");
    } catch {
        alert("Invalid URL.");
    }
}


function insertExportButton() {
    if (document.getElementById("chatgpt-export-container")) return;

    const container = document.createElement("div");
    container.id = "chatgpt-export-container";

    container.style.position = "fixed";
    container.style.bottom = "24px";
    container.style.right = "24px";
    container.style.zIndex = "9999";
    container.style.fontFamily = "system-ui, sans-serif";

    const button = document.createElement("button");
    button.id = "chatgpt-export-btn";
    button.innerText = "Export";

    button.style.background = "#10a37f";
    button.style.color = "white";
    button.style.border = "none";
    button.style.borderRadius = "999px";
    button.style.padding = "12px 18px";
    button.style.fontSize = "14px";
    button.style.cursor = "pointer";
    button.style.boxShadow = "0 4px 14px rgba(0,0,0,0.25)";
    button.style.transition = "all 0.2s ease";

    button.onmouseenter = () => {
        button.style.transform = "translateY(-2px)";
        button.style.boxShadow = "0 6px 18px rgba(0,0,0,0.3)";
    };

    button.onmouseleave = () => {
        button.style.transform = "translateY(0)";
        button.style.boxShadow = "0 4px 14px rgba(0,0,0,0.25)";
    };

    button.onclick = () => toggleDropdown(container);

    container.appendChild(button);
    document.body.appendChild(container);
}

// Ensure the DOM is fully loaded before inserting the button
document.addEventListener('DOMContentLoaded', () => {
    insertExportButton();
});

const observer = new MutationObserver(() => {
    insertExportButton();
});

function toggleDropdown(container) {
    const existing = document.getElementById("chatgpt-export-dropdown");

    if (existing) {
        existing.remove();
        return;
    }

    const dropdown = document.createElement("div");
    dropdown.id = "chatgpt-export-dropdown";

    dropdown.style.position = "absolute";
    dropdown.style.bottom = "60px";
    dropdown.style.right = "0";
    dropdown.style.width = "220px";
    dropdown.style.background = "#ffffff";
    dropdown.style.border = "1px solid #e5e5e5";
    dropdown.style.borderRadius = "10px";
    dropdown.style.boxShadow = "0 10px 30px rgba(0,0,0,0.2)";
    dropdown.style.overflow = "hidden";
    dropdown.style.animation = "fadeInUp 0.15s ease";

    dropdown.appendChild(createOption(
        "Export Current Conversation",
        exportCurrentConversation
    ));

    dropdown.appendChild(createOption(
        "Export All Conversations",
        exportAllConversations
    ));

    dropdown.appendChild(createOption(
        "Set Server URL",
        promptServerURL
    ));

    container.appendChild(dropdown);

    document.addEventListener("click", function close(e) {
        if (!container.contains(e.target)) {
            dropdown.remove();
            document.removeEventListener("click", close);
        }
    });
}

function createOption(label, handler) {
    const option = document.createElement("div");

    option.innerText = label;

    option.style.padding = "12px 16px";
    option.style.cursor = "pointer";
    option.style.fontSize = "14px";
    option.style.transition = "background 0.15s";

    option.onmouseenter = () => {
        option.style.background = "#f5f5f5";
    };

    option.onmouseleave = () => {
        option.style.background = "transparent";
    };

    option.onclick = async () => {
        document.getElementById("chatgpt-export-dropdown")?.remove();
        await handler();
    };

    return option;
}

insertExportButton();

observer.observe(document.body, { childList: true, subtree: true});

async function transferToBridge(allConversations, allAttachments) {
    console.log("Starting secure transfer...");

    const llmURL = await getServerURL();

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

async function getServerURL() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(["llmServerURL"], (result) => {
            resolve(result.llmServerURL || "http://localhost:3000");
        });
    });
}

async function setServerURL(url) {
    return new Promise((resolve) => {
        chrome.storage.sync.set({ llmServerURL: url }, resolve);
    });
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
        try {
            const res = await fetch(att.url, { credentials: "include" });

            // Extract filename from Content-Disposition or URL if not available
            let filename = att.filename; // Default filename (fallback)
            const contentDisposition = res.headers.get('Content-Disposition');
            if (contentDisposition) {
                const match = contentDisposition.match(/filename="([^"]+)"/);
                if (match && match[1]) {
                    filename = match[1];  // Extracted filename from the header
                }
            } else {
                // Fallback to extracting from URL (if Content-Disposition is not present)
                const urlParts = new URL(att.url).pathname.split('/');
                filename = urlParts[urlParts.length - 1];
            }

            console.log(`Filename: ${filename} \n Temp Filename: ${att.filename}`);

            const blob = await res.blob();

            // Create form for file upload
            const formData = new FormData();
            formData.append("sessionId", sessionId);
            formData.append("file", blob, filename);
            formData.append("tempFilename", att.filename);

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

    console.log(`${articles.length} messages found in this conversation`);
    // For each message...
    for (const article of articles) {
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
        for (const button of buttons) {

            const waitPromise = waitForAttachment();

            button.click();

            // Wait 5 seconds to catch url and return null if not caught in time
            const url = await Promise.race([
                waitPromise,
                delay(5000).then(() => null)
            ]);

            console.log("5 seconds? " + url);

            if (url) {
                const uuid = window.crypto.randomUUID();

                const filename = uuid;
                const attachment = { type: "file", filename, url};
                
                msgAttachments.push(attachment);

                attachments.push(attachment);
                console.log(`${attachment.filename} stored`);
            }
        }

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
    }


    if (!conversation.length) return null;

    console.log("Files in conversation ---------------");
    for( const att of attachments){
        console.log("File: " + att.filename);
    }

    console.log("END ---------------");

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

// Export Current Conversation
async function exportCurrentConversation() {
    console.log("Exporting current conversation...");
    const convData = await runExportForConversation();
    if (convData) {
        // Do the export or processing for just the current conversation
        console.log("Current Conversation Exported:", convData);
        // You can now transfer this data to your server or download as required
        await transferToBridge([convData], convData.attachments);
    } else {
        console.log("No conversation data found to export.");
    }
}


// --- Main batch export ---
async function exportAllConversations() {
    console.log("Exporting all conversations...");
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





