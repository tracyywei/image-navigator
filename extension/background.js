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
chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (!tabs[0]) return;
    
    if (command === 'open-image-navigator') {
      chrome.tabs.sendMessage(tabs[0].id, {action: 'startImageNavigation'});
    } else if (command === 'increase-voice-speed') {
      chrome.tabs.sendMessage(tabs[0].id, {action: 'increaseVoiceSpeed'});
    } else if (command === 'decrease-voice-speed') {
      chrome.tabs.sendMessage(tabs[0].id, {action: 'decreaseVoiceSpeed'});
    }
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
        post({
          type: 'error',
          errorType: response.status === 500 ? 'Configuration' : 'Unknown',
          message: errorData.message || errorData.error || `HTTP ${response.status}: ${response.statusText}`
        });
        post({ type: 'done' });
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
        post({ type: 'error', errorType: 'Network', message: 'Connection to the server closed before analysis finished' });
        post({ type: 'done' });
      }
    } catch (error) {
      if (disconnected) return;
      console.error('[Image Rotor Background] API call failed:', error);
      post({
        type: 'error',
        errorType: 'Network',
        message: error.message || 'Unknown error'
      });
      post({ type: 'done' });
    }
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'image-rotor' && info.srcUrl) {
    // Send message to content script to open the rotor for this image
    chrome.tabs.sendMessage(tab.id, {
      action: 'openRotor',
      imageUrl: info.srcUrl,
      altText: info.mediaType === 'image' ? (info.targetElementAlt || '') : ''
    }).catch((error) => {
      console.error('[Image Rotor] Failed to send message to content script:', error);
      // Try to inject the content script if it's not loaded
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      }).then(() => {
        // Retry sending the message
        chrome.tabs.sendMessage(tab.id, {
          action: 'openRotor',
          imageUrl: info.srcUrl,
          altText: info.mediaType === 'image' ? (info.targetElementAlt || '') : ''
        });
      }).catch((injectError) => {
        console.error('[Image Rotor] Failed to inject content script:', injectError);
      });
    });
  }
});

// Handle toolbar button clicks
chrome.action.onClicked.addListener((tab) => {
  // Toggle the image rotor mode on the page
  chrome.tabs.sendMessage(tab.id, {
    action: 'toggleImageSelector'
  }).catch((error) => {
    console.error('[Image Rotor] Failed to send message to content script:', error);
    // Try to inject the content script if it's not loaded
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    }).then(() => {
      // Retry sending the message
      chrome.tabs.sendMessage(tab.id, {
        action: 'toggleImageSelector'
      });
    }).catch((injectError) => {
      console.error('[Image Rotor] Failed to inject content script:', injectError);
    });
  });
});
