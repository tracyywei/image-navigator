// Background service worker for Image Rotor extension

// Create context menu item for images
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'image-rotor',
    title: 'Analyze with Image Rotor',
    contexts: ['image']
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
    });
  }
});

// Handle toolbar button clicks
chrome.action.onClicked.addListener((tab) => {
  // Toggle the image rotor mode on the page
  chrome.tabs.sendMessage(tab.id, {
    action: 'toggleImageSelector'
  });
});
