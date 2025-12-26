// Image Rotor Content Script
// This injects the rotor UI into web pages

(function() {
  'use strict';

  // State
  let isSelectingImage = false;
  let rotorPanel = null;
  let currentImage = null;
  let highlightOverlay = null;
  let selectedItem = null;
  let currentLens = 'objects';
  let focusedIndex = 0;
  let isRotorFocused = false;
  let isSpeaking = false;

  // Demo data structure - in a real extension, this would come from an AI service
  const lensOrder = ['objects', 'layout', 'style'];
  const lensLabels = {
    objects: 'Objects',
    layout: 'Layout',
    style: 'Style'
  };
  const lensDescriptions = {
    objects: 'Physical things in the image',
    layout: 'Spatial organization',
    style: 'Visual qualities'
  };

  // Generate demo analysis for any image
  function generateDemoAnalysis(imageUrl, altText) {
    return {
      altText: altText || 'An image on the web page. Right-click and select "Analyze with Image Rotor" for detailed AI analysis.',
      imageUrl: imageUrl,
      lenses: {
        objects: [
          { id: 'obj-1', label: 'Primary subject', description: 'The main focal point of this image. In a full implementation, AI would identify specific objects.', regionHint: { x: 30, y: 30, width: 40, height: 40 } },
          { id: 'obj-2', label: 'Background elements', description: 'Secondary visual elements that provide context and depth to the scene.', regionHint: { x: 0, y: 0, width: 100, height: 50 } },
          { id: 'obj-3', label: 'Foreground details', description: 'Elements in the front of the composition that may frame or lead into the main subject.', regionHint: { x: 10, y: 60, width: 80, height: 35 } }
        ],
        layout: [
          { id: 'lay-1', label: 'Composition structure', description: 'The overall arrangement follows a balanced layout, guiding the viewer\'s eye through the image.', regionHint: { x: 0, y: 0, width: 100, height: 100 } },
          { id: 'lay-2', label: 'Visual hierarchy', description: 'The image establishes clear focal points through size, contrast, and positioning.', regionHint: { x: 20, y: 20, width: 60, height: 60 } },
          { id: 'lay-3', label: 'Negative space', description: 'Areas of the image that provide visual rest and help emphasize the main subject.', regionHint: { x: 70, y: 10, width: 25, height: 30 } }
        ],
        style: [
          { id: 'sty-1', label: 'Color palette', description: 'The dominant colors and their relationships create the overall mood and atmosphere.' },
          { id: 'sty-2', label: 'Lighting quality', description: 'The lighting direction and intensity affect how forms are revealed and shadows are cast.' },
          { id: 'sty-3', label: 'Visual texture', description: 'Surface qualities and patterns that add tactile interest and depth to the image.' },
          { id: 'sty-4', label: 'Contrast levels', description: 'The range between light and dark areas, affecting visual impact and readability.' }
        ]
      }
    };
  }

  // Speech synthesis
  function speak(text) {
    if (!text || !('speechSynthesis' in window)) return;
    
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.onstart = () => { isSpeaking = true; updateSpeakingIndicator(); };
    utterance.onend = () => { isSpeaking = false; updateSpeakingIndicator(); };
    utterance.onerror = () => { isSpeaking = false; updateSpeakingIndicator(); };
    window.speechSynthesis.speak(utterance);
  }

  function updateSpeakingIndicator() {
    const indicator = document.querySelector('.ir-speaking-indicator');
    if (indicator) {
      indicator.classList.toggle('ir-active', isSpeaking);
    }
  }

  // Create the rotor panel UI
  function createRotorPanel(imageData) {
    removeRotorPanel();

    const panel = document.createElement('div');
    panel.className = 'ir-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Image Rotor');
    panel.innerHTML = `
      <div class="ir-container">
        <div class="ir-live-region" aria-live="polite" aria-atomic="true"></div>
        
        <header class="ir-header">
          <div class="ir-header-top">
            <div class="ir-alt-badge">ALT</div>
            <p class="ir-alt-text">${escapeHtml(imageData.altText)}</p>
            <button class="ir-btn ir-btn-icon ir-speak-btn" aria-label="Read alt text aloud">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
              </svg>
              <span class="ir-speaking-indicator"></span>
            </button>
            <button class="ir-btn ir-btn-icon ir-close-btn" aria-label="Close Image Rotor">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="ir-keyboard-hints">
            <kbd>R</kbd> Toggle rotor
            <span class="ir-hint-sep">·</span>
            <kbd>←</kbd><kbd>→</kbd> Switch lens
            <span class="ir-hint-sep">·</span>
            <kbd>↑</kbd><kbd>↓</kbd> Navigate
            <span class="ir-hint-sep">·</span>
            <kbd>Enter</kbd> Select
            <span class="ir-hint-sep">·</span>
            <kbd>Esc</kbd> Close
          </div>
        </header>
        
        <div class="ir-main">
          <div class="ir-rotor">
            <div class="ir-lens-nav">
              <button class="ir-btn ir-btn-icon ir-lens-prev" aria-label="Previous lens">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
              </button>
              <div class="ir-lens-info">
                <span class="ir-lens-label">${lensLabels[currentLens]}</span>
                <span class="ir-lens-desc">${lensDescriptions[currentLens]}</span>
              </div>
              <button class="ir-btn ir-btn-icon ir-lens-next" aria-label="Next lens">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
            </div>
            <div class="ir-lens-indicators">
              ${lensOrder.map(lens => `<div class="ir-lens-dot ${lens === currentLens ? 'ir-active' : ''}" data-lens="${lens}"></div>`).join('')}
            </div>
            <ul class="ir-items-list" role="listbox" aria-label="Rotor items"></ul>
            <div class="ir-items-count"></div>
          </div>
          
          <div class="ir-image-container">
            <img src="${imageData.imageUrl}" alt="${escapeHtml(imageData.altText)}" class="ir-image" />
            <div class="ir-region-overlay" style="display: none;"></div>
          </div>
          
          <div class="ir-detail">
            <div class="ir-detail-empty">
              <p>Select an item from the rotor to see its detailed description.</p>
              <p class="ir-detail-hint">Press <kbd>R</kbd> to focus the rotor</p>
            </div>
            <div class="ir-detail-content" style="display: none;">
              <div class="ir-detail-header">
                <h3 class="ir-detail-title"></h3>
                <div class="ir-detail-actions">
                  <button class="ir-btn ir-btn-icon ir-detail-speak" aria-label="Read description">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                    </svg>
                  </button>
                </div>
              </div>
              <p class="ir-detail-description"></p>
            </div>
          </div>
        </div>
        
        <footer class="ir-footer">
          <span>Image Rotor Extension</span>
          <div class="ir-status">
            <span class="ir-status-tts">
              <span class="ir-status-dot"></span>
              TTS Ready
            </span>
            <span class="ir-status-rotor">
              <span class="ir-status-dot"></span>
              Rotor Inactive
            </span>
          </div>
        </footer>
      </div>
    `;

    document.body.appendChild(panel);
    rotorPanel = panel;

    // Store image data for later use
    panel.imageData = imageData;

    // Render initial items
    renderItems();

    // Attach event listeners
    attachPanelListeners(panel);

    // Announce and speak alt text
    announce(imageData.altText);
    speak(imageData.altText);

    // Focus the panel
    panel.focus();
  }

  function renderItems() {
    if (!rotorPanel) return;
    
    const imageData = rotorPanel.imageData;
    const items = imageData.lenses[currentLens] || [];
    const listEl = rotorPanel.querySelector('.ir-items-list');
    const countEl = rotorPanel.querySelector('.ir-items-count');
    
    listEl.innerHTML = items.map((item, index) => `
      <li>
        <button 
          class="ir-item ${index === focusedIndex && isRotorFocused ? 'ir-focused' : ''} ${selectedItem?.id === item.id ? 'ir-selected' : ''}"
          data-index="${index}"
          data-id="${item.id}"
          role="option"
          aria-selected="${selectedItem?.id === item.id}"
        >
          ${escapeHtml(item.label)}
        </button>
      </li>
    `).join('');
    
    countEl.textContent = `${items.length} ${items.length === 1 ? 'item' : 'items'} in ${lensLabels[currentLens].toLowerCase()}`;
    
    // Update lens info
    rotorPanel.querySelector('.ir-lens-label').textContent = lensLabels[currentLens];
    rotorPanel.querySelector('.ir-lens-desc').textContent = lensDescriptions[currentLens];
    
    // Update lens indicators
    rotorPanel.querySelectorAll('.ir-lens-dot').forEach(dot => {
      dot.classList.toggle('ir-active', dot.dataset.lens === currentLens);
    });
    
    // Update rotor status
    const rotorStatus = rotorPanel.querySelector('.ir-status-rotor');
    rotorStatus.querySelector('.ir-status-dot').classList.toggle('ir-active', isRotorFocused);
    rotorStatus.childNodes[1].textContent = isRotorFocused ? ' Rotor Active' : ' Rotor Inactive';
    
    // Update rotor panel border
    rotorPanel.querySelector('.ir-rotor').classList.toggle('ir-rotor-focused', isRotorFocused);
  }

  function selectItem(item) {
    selectedItem = item;
    
    const detailEmpty = rotorPanel.querySelector('.ir-detail-empty');
    const detailContent = rotorPanel.querySelector('.ir-detail-content');
    
    if (item) {
      detailEmpty.style.display = 'none';
      detailContent.style.display = 'block';
      rotorPanel.querySelector('.ir-detail-title').textContent = item.label;
      rotorPanel.querySelector('.ir-detail-description').textContent = item.description;
      
      // Show region overlay
      if (item.regionHint) {
        const overlay = rotorPanel.querySelector('.ir-region-overlay');
        overlay.style.display = 'block';
        overlay.style.left = `${item.regionHint.x}%`;
        overlay.style.top = `${item.regionHint.y}%`;
        overlay.style.width = `${item.regionHint.width}%`;
        overlay.style.height = `${item.regionHint.height}%`;
      } else {
        rotorPanel.querySelector('.ir-region-overlay').style.display = 'none';
      }
      
      speak(item.description);
      announce(item.description);
    } else {
      detailEmpty.style.display = 'block';
      detailContent.style.display = 'none';
      rotorPanel.querySelector('.ir-region-overlay').style.display = 'none';
    }
    
    renderItems();
  }

  function navigateLens(direction) {
    const currentIndex = lensOrder.indexOf(currentLens);
    let newIndex;
    
    if (direction === 'left') {
      newIndex = currentIndex === 0 ? lensOrder.length - 1 : currentIndex - 1;
    } else {
      newIndex = currentIndex === lensOrder.length - 1 ? 0 : currentIndex + 1;
    }
    
    currentLens = lensOrder[newIndex];
    focusedIndex = 0;
    selectedItem = null;
    
    const items = rotorPanel.imageData.lenses[currentLens] || [];
    announce(`${lensLabels[currentLens]} lens, ${items.length} items`);
    renderItems();
    
    // Hide detail panel
    rotorPanel.querySelector('.ir-detail-empty').style.display = 'block';
    rotorPanel.querySelector('.ir-detail-content').style.display = 'none';
    rotorPanel.querySelector('.ir-region-overlay').style.display = 'none';
  }

  function announce(message) {
    if (!rotorPanel) return;
    const liveRegion = rotorPanel.querySelector('.ir-live-region');
    liveRegion.textContent = message;
  }

  function attachPanelListeners(panel) {
    // Close button
    panel.querySelector('.ir-close-btn').addEventListener('click', removeRotorPanel);
    
    // Speak alt text button
    panel.querySelector('.ir-speak-btn').addEventListener('click', () => {
      speak(panel.imageData.altText);
    });
    
    // Detail speak button
    panel.querySelector('.ir-detail-speak').addEventListener('click', () => {
      if (selectedItem) speak(selectedItem.description);
    });
    
    // Lens navigation
    panel.querySelector('.ir-lens-prev').addEventListener('click', () => navigateLens('left'));
    panel.querySelector('.ir-lens-next').addEventListener('click', () => navigateLens('right'));
    
    // Item clicks
    panel.querySelector('.ir-items-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.ir-item');
      if (btn) {
        const index = parseInt(btn.dataset.index);
        const items = panel.imageData.lenses[currentLens] || [];
        focusedIndex = index;
        selectItem(items[index]);
      }
    });
    
    // Keyboard navigation
    document.addEventListener('keydown', handleKeyDown);
  }

  function handleKeyDown(e) {
    if (!rotorPanel) return;
    
    const items = rotorPanel.imageData.lenses[currentLens] || [];
    
    // R toggles rotor focus
    if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      isRotorFocused = !isRotorFocused;
      if (isRotorFocused) {
        announce(`Rotor opened. ${lensLabels[currentLens]} lens, ${items.length} items. Use arrow keys to navigate.`);
      } else {
        announce('Rotor closed');
      }
      renderItems();
      return;
    }
    
    // Escape closes panel
    if (e.key === 'Escape') {
      e.preventDefault();
      removeRotorPanel();
      return;
    }
    
    if (!isRotorFocused) return;
    
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        if (items.length > 0) {
          focusedIndex = focusedIndex === 0 ? items.length - 1 : focusedIndex - 1;
          announce(items[focusedIndex].label);
          renderItems();
        }
        break;
        
      case 'ArrowDown':
        e.preventDefault();
        if (items.length > 0) {
          focusedIndex = focusedIndex === items.length - 1 ? 0 : focusedIndex + 1;
          announce(items[focusedIndex].label);
          renderItems();
        }
        break;
        
      case 'ArrowLeft':
        e.preventDefault();
        navigateLens('left');
        break;
        
      case 'ArrowRight':
        e.preventDefault();
        navigateLens('right');
        break;
        
      case 'Enter':
        e.preventDefault();
        if (items[focusedIndex]) {
          selectItem(items[focusedIndex]);
        }
        break;
    }
  }

  function removeRotorPanel() {
    if (rotorPanel) {
      document.removeEventListener('keydown', handleKeyDown);
      rotorPanel.remove();
      rotorPanel = null;
      selectedItem = null;
      focusedIndex = 0;
      isRotorFocused = false;
      window.speechSynthesis.cancel();
    }
    removeImageSelector();
  }

  // Image selector mode
  function enableImageSelector() {
    isSelectingImage = true;
    document.body.classList.add('ir-selecting');
    
    // Add overlay hint
    const hint = document.createElement('div');
    hint.className = 'ir-selector-hint';
    hint.textContent = 'Click on an image to analyze it with Image Rotor. Press Esc to cancel.';
    document.body.appendChild(hint);
    
    document.addEventListener('click', handleImageClick, true);
    document.addEventListener('mouseover', handleImageHover, true);
    document.addEventListener('mouseout', handleImageUnhover, true);
    document.addEventListener('keydown', handleSelectorKeydown);
  }

  function removeImageSelector() {
    isSelectingImage = false;
    document.body.classList.remove('ir-selecting');
    
    const hint = document.querySelector('.ir-selector-hint');
    if (hint) hint.remove();
    
    const highlight = document.querySelector('.ir-image-highlight');
    if (highlight) highlight.remove();
    
    document.removeEventListener('click', handleImageClick, true);
    document.removeEventListener('mouseover', handleImageHover, true);
    document.removeEventListener('mouseout', handleImageUnhover, true);
    document.removeEventListener('keydown', handleSelectorKeydown);
  }

  function handleImageClick(e) {
    if (!isSelectingImage) return;
    
    const img = e.target.closest('img');
    if (img) {
      e.preventDefault();
      e.stopPropagation();
      
      const imageData = generateDemoAnalysis(img.src, img.alt);
      removeImageSelector();
      createRotorPanel(imageData);
    }
  }

  function handleImageHover(e) {
    if (!isSelectingImage) return;
    
    const img = e.target.closest('img');
    if (img) {
      let highlight = document.querySelector('.ir-image-highlight');
      if (!highlight) {
        highlight = document.createElement('div');
        highlight.className = 'ir-image-highlight';
        document.body.appendChild(highlight);
      }
      
      const rect = img.getBoundingClientRect();
      highlight.style.top = `${rect.top + window.scrollY}px`;
      highlight.style.left = `${rect.left + window.scrollX}px`;
      highlight.style.width = `${rect.width}px`;
      highlight.style.height = `${rect.height}px`;
      highlight.style.display = 'block';
    }
  }

  function handleImageUnhover(e) {
    if (!isSelectingImage) return;
    
    const img = e.target.closest('img');
    if (img) {
      const highlight = document.querySelector('.ir-image-highlight');
      if (highlight) highlight.style.display = 'none';
    }
  }

  function handleSelectorKeydown(e) {
    if (e.key === 'Escape') {
      removeImageSelector();
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'toggleImageSelector':
        if (rotorPanel) {
          removeRotorPanel();
        } else if (isSelectingImage) {
          removeImageSelector();
        } else {
          enableImageSelector();
        }
        break;
        
      case 'openRotor':
        const imageData = generateDemoAnalysis(message.imageUrl, message.altText);
        createRotorPanel(imageData);
        break;
    }
  });

})();
