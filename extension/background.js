chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PAUSE_GEMINI") {
    // Query all open tabs that match the Gemini URL
    chrome.tabs.query({ url: "*://gemini.google.com/*" }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.remove(tab.id);
      }
    });
  }
});

// Actively monitor for ANY new tabs navigating to Gemini while already paused
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tab.url && tab.url.includes("gemini.google.com")) {
    try {
      // Check the backend to see if the game is currently paused
      const res = await fetch("http://localhost:5001/api/game/status");
      const data = await res.json();
      if (data && data.session && data.session.isPaused) {
        chrome.tabs.remove(tabId);
      }
    } catch (e) {
      console.error("Failed to check game status", e);
    }
  }
});
