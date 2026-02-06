chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url.includes("chat.openai.com")) {
    alert("Open a ChatGPT conversation first.");
    return;
  }

  await chrome.scripting.exceuteScript({
    target: { tabId: tab.id },
    files: ["extract.js"]
  });
});
