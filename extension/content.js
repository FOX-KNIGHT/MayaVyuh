// Listen for the custom event dispatched by the React frontend
window.addEventListener("mayavyuh_pause", () => {
  // Relay the message to the background script
  chrome.runtime.sendMessage({ type: "PAUSE_GEMINI" });
});
