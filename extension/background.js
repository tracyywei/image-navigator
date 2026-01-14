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

// Handle API requests from content script (bypasses CORS)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'describeImage') {
    console.log('[Image Rotor Background] Proxying API request to:', API_BASE_URL);
    
    // First check health
    fetch(`${API_BASE_URL}/health`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`Server health check failed: ${response.status}`);
        }
        console.log('[Image Rotor Background] Server is reachable');
        
        // Then make the actual API call
        return fetch(`${API_BASE_URL}/api/describe-image`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(message.payload)
        });
      })
      .then(response => {
        if (!response.ok) {
          return response.json().then(errorData => {
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
          });
        }
        return response.json();
      })
      .then(data => {
        console.log('[Image Rotor Background] API call successful');
        sendResponse({ success: true, data: data });
      })
      .catch(error => {
        console.error('[Image Rotor Background] API call failed:', error);
        console.error('[Image Rotor Background] Error details:', {
          message: error.message,
          stack: error.stack,
          name: error.name
        });
        sendResponse({ 
          success: false, 
          error: error.message || 'Unknown error',
          errorType: error.errorType || 'Network',
          details: error.toString()
        });
      });
    
    return true; // Keep channel open for async response
  }
  
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
