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

// --- Create Export Button with Dropdown ---
function createExportButton() {
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

    // Click handler to show dropdown
    btn.addEventListener("click", async () => {
        showExportDropdown(btn);
    });

    return btn;
}

// --- Show the Dropdown to Choose Export Option ---
function showExportDropdown(btn) {
    // Check if dropdown already exists and remove it if so
    let existingDropdown = document.getElementById('chatgpt-export-dropdown');
    if (existingDropdown) {
        existingDropdown.remove();
    }

    // Create a new dropdown container
    const dropdown = document.createElement('div');
    dropdown.id = 'chatgpt-export-dropdown';
    dropdown.style.position = 'absolute';
    dropdown.style.top = `${btn.offsetTop + btn.offsetHeight + 5}px`;
    dropdown.style.left = `${btn.offsetLeft}px`;
    dropdown.style.backgroundColor = '#fff';
    dropdown.style.border = '1px solid #ddd';
    dropdown.style.borderRadius = '4px';
    dropdown.style.boxShadow = '0px 2px 5px rgba(0,0,0,0.15)';
    dropdown.style.zIndex = '9999';
    dropdown.style.width = '160px';

    // Add the options to the dropdown
    const exportCurrentOption = document.createElement('div');
    exportCurrentOption.innerText = 'Export Current Conversation';
    exportCurrentOption.style.padding = '8px';
    exportCurrentOption.style.cursor = 'pointer';
    exportCurrentOption.style.fontSize = '14px';

    const exportAllOption = document.createElement('div');
    exportAllOption.innerText = 'Export All Conversations';
    exportAllOption.style.padding = '8px';
    exportAllOption.style.cursor = 'pointer';
    exportAllOption.style.fontSize = '14px';

    // Hover effects for options
    exportCurrentOption.onmouseover = () => (exportCurrentOption.style.backgroundColor = '#f1f1f1');
    exportCurrentOption.onmouseout = () => (exportCurrentOption.style.backgroundColor = '');
    
    exportAllOption.onmouseover = () => (exportAllOption.style.backgroundColor = '#f1f1f1');
    exportAllOption.onmouseout = () => (exportAllOption.style.backgroundColor = '');

    // Event listeners for options
    exportCurrentOption.addEventListener('click', async () => {
        await exportCurrentConversation();
        dropdown.remove(); // Close dropdown after selection
    });

    exportAllOption.addEventListener('click', async () => {
        await exportAllConversations();
        dropdown.remove(); // Close dropdown after selection
    });

    // Append options to dropdown
    dropdown.appendChild(exportCurrentOption);
    dropdown.appendChild(exportAllOption);

    // Append dropdown to the body
    document.body.appendChild(dropdown);

    // Close dropdown if clicked outside
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== btn) {
            dropdown.remove();
        }
    });
}


function insertExportButton() {
    // Check if the export button already exists
    if (document.getElementById("chatgpt-export-btn")) return;

    // Ensure the header exists
    const header = document.querySelector('header');
    if (!header) {
        console.error("Header element not found. Retry after DOM is fully loaded.");
        return;
    }

    // Create the export button
    const btn = createExportButton();

    // Append the button to the header
    header.appendChild(btn);
}

// Ensure the DOM is fully loaded before inserting the button
document.addEventListener('DOMContentLoaded', () => {
    insertExportButton();
});

const observer = new MutationObserver(() => {
    insertExportButton();
});

observer.observe(document.body, { childList: true, subtree: true});

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



