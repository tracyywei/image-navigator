// Background service worker for Image Rotor extension

const API_BASE_URL = 'http://localhost:3001';

// Create context menu item for images
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'image-rotor',
    title: 'Analyze with Image Rotor',
    contexts: ['image']
  });
});

// Handle keyboard shortcuts
const COMMAND_ACTIONS = {
  'open-image-navigator': 'startImageNavigation',
  'increase-voice-speed': 'increaseVoiceSpeed',
  'decrease-voice-speed': 'decreaseVoiceSpeed'
};

chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    const action = COMMAND_ACTIONS[command];
    if (!tabs[0] || !action) return;
    chrome.tabs.sendMessage(tabs[0].id, { action });
  });
});

// Handle API requests from content script (bypasses CORS).
// The server streams newline-delimited JSON events; each one is forwarded over the
// port as it arrives so the rotor can fill in progressively. Disconnecting the port
// (panel closed, prefetch cancelled) aborts the request, which also stops the
// server's OpenAI calls.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'describeImage') return;

  const abortController = new AbortController();
  let disconnected = false;
  port.onDisconnect.addListener(() => {
    disconnected = true;
    abortController.abort();
  });

  const post = (event) => {
    if (!disconnected) port.postMessage(event);
  };
  const fail = (errorType, message) => {
    post({ type: 'error', errorType, message });
    post({ type: 'done' });
  };

  port.onMessage.addListener(async (message) => {
    console.log('[Image Rotor Background] Proxying API request to:', API_BASE_URL);
    try {
      const response = await fetch(`${API_BASE_URL}/api/describe-image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message.payload),
        signal: abortController.signal
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        fail(
          response.status === 500 ? 'Configuration' : 'Unknown',
          errorData.message || errorData.error || `HTTP ${response.status}: ${response.statusText}`
        );
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sawDone = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === 'done') sawDone = true;
          post(event);
        }
      }
      if (!sawDone) {
        fail('Network', 'Connection to the server closed before analysis finished');
      }
    } catch (error) {
      if (disconnected) return;
      console.error('[Image Rotor Background] API call failed:', error);
      fail('Network', error.message || 'Unknown error');
    }
  });
});

// Send a message to the tab's content script, injecting the script first if it isn't loaded
function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch((error) => {
    console.error('[Image Rotor] Failed to send message to content script:', error);
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    }).then(() => {
      chrome.tabs.sendMessage(tabId, message);
    }).catch((injectError) => {
      console.error('[Image Rotor] Failed to inject content script:', injectError);
    });
  });
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'image-rotor' || !info.srcUrl) return;
  sendToTab(tab.id, {
    action: 'openRotor',
    imageUrl: info.srcUrl,
    altText: info.mediaType === 'image' ? (info.targetElementAlt || '') : ''
  });
});

// Handle toolbar button clicks: toggle image selection mode on the page
chrome.action.onClicked.addListener((tab) => {
  sendToTab(tab.id, { action: 'toggleImageSelector' });
});
