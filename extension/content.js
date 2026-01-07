// Image Rotor Content Script
// This injects the rotor UI into web pages with OpenAI Vision integration

(function() {
  'use strict';

  console.log('[Image Rotor] Content script loaded - v2.0 with OpenAI integration');
  console.log('[Image Rotor] Script location:', window.location.href);

  // Configuration
  const API_BASE_URL = 'http://localhost:3001'; // Change this to your backend URL
  
  // Test message listener is working
  console.log('[Image Rotor] Setting up message listener...');

  // State
  let isSelectingImage = false;
  let rotorPanel = null;
  let currentImage = null;
  let highlightOverlay = null;
  let selectedItem = null;
  let currentLens = null; // Will be set to first lens dynamically
  let focusedIndex = 0;
  let isRotorFocused = false;
  let imageDataCache = new Map();
  let isLoading = false;
  let hasSpokenAltText = false;
  let lastLensSpoken = null; // Track last lens label spoken to avoid repetition
  let lastSelectedItemId = null; // Track last selected item to avoid re-speaking
  
  // Drill-down navigation state
  let drillDownStack = []; // Stack of {item, parentItems, focusedIndex} for navigation history
  let isDrilledDown = false; // Whether we're currently viewing sub-items

  // Lens configuration - will be populated dynamically from API response
  let lensOrder = [];
  let lensLabels = {};
  let lensDescriptions = {};

  // Enhanced TTS Manager (inline - matches tts-manager.js)
  class EnhancedTTSManager {
    constructor() {
      this.isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
      this.isSpeaking = false;
      this.lastSpokenText = null;
      this.currentUtterance = null;
      this.focusDebounceTimer = null;
      this.focusDebounceDelay = 175;
      this.lastFocusedText = null;
      this.lastSpokenTime = 0;
      this.sameTextThreshold = 1000;
      this.enabled = true;
    }

    setEnabled(enabled) {
      this.enabled = enabled;
      if (!enabled) this.stop();
    }

    speak(text, options = {}) {
      if (!this.isSupported || !this.enabled || !text || text.trim().length === 0) {
        return;
      }

      const { interrupt = true, debounceMs = 0 } = options;

      const now = Date.now();
      if (text === this.lastSpokenText && this.isSpeaking && (now - this.lastSpokenTime) < this.sameTextThreshold) {
        return;
      }

      if (this.focusDebounceTimer) {
        clearTimeout(this.focusDebounceTimer);
        this.focusDebounceTimer = null;
      }

      const doSpeak = () => {
        if (interrupt) {
          this.stop();
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;
        utterance.pitch = 1;
        utterance.volume = 1;

        utterance.onstart = () => {
          this.isSpeaking = true;
          this.currentUtterance = utterance;
          this.lastSpokenText = text;
          this.lastSpokenTime = Date.now();
          updateSpeakingIndicator(true);
        };

        utterance.onend = () => {
          this.isSpeaking = false;
          this.currentUtterance = null;
          updateSpeakingIndicator(false);
        };

        utterance.onerror = () => {
          this.isSpeaking = false;
          this.currentUtterance = null;
          updateSpeakingIndicator(false);
        };

        window.speechSynthesis.speak(utterance);
      };

      if (debounceMs > 0) {
        if (text === this.lastFocusedText) {
          return;
        }
        this.lastFocusedText = text;
        this.focusDebounceTimer = setTimeout(() => {
          this.focusDebounceTimer = null;
          doSpeak();
        }, debounceMs);
      } else {
        this.lastFocusedText = null;
        doSpeak();
      }
    }

    speakDebounced(text) {
      this.speak(text, { debounceMs: this.focusDebounceDelay });
    }

    stop() {
      if (this.isSupported) {
        window.speechSynthesis.cancel();
      }
      if (this.focusDebounceTimer) {
        clearTimeout(this.focusDebounceTimer);
        this.focusDebounceTimer = null;
      }
      this.isSpeaking = false;
      this.currentUtterance = null;
      updateSpeakingIndicator(false);
    }

    getLastSpoken() {
      return this.lastSpokenText;
    }

    replayLast() {
      if (this.lastSpokenText) {
        this.speak(this.lastSpokenText, { interrupt: true, debounceMs: 0 });
      }
    }
  }

  const ttsManager = new EnhancedTTSManager();

  // Predictive Orderer (inline - matches predictive-ordering.js)
  class PredictiveOrderer {
    constructor() {
      this.storageKey = 'imageRotor_usageStats';
      this.enabled = true;
      this.usageStats = {
        clickCountByItemId: {},
        lastSelectedTimestamps: {},
        preferredLensOrder: {}
      };
      this.loadSettings();
    }

    async loadSettings() {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          const result = await chrome.storage.local.get(['predictiveOrdering', this.storageKey]);
          this.enabled = result.predictiveOrdering !== false;
          this.usageStats = result[this.storageKey] || this.usageStats;
        } else {
          const stored = localStorage.getItem('imageRotor_predictiveOrdering');
          this.enabled = stored !== 'false';
          const stats = localStorage.getItem(this.storageKey);
          this.usageStats = stats ? JSON.parse(stats) : this.usageStats;
        }
      } catch (error) {
        console.warn('[Predictive Orderer] Failed to load:', error);
      }
    }

    async saveSettings() {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          await chrome.storage.local.set({
            predictiveOrdering: this.enabled,
            [this.storageKey]: this.usageStats
          });
        } else {
          localStorage.setItem('imageRotor_predictiveOrdering', String(this.enabled));
          localStorage.setItem(this.storageKey, JSON.stringify(this.usageStats));
        }
      } catch (error) {
        console.warn('[Predictive Orderer] Failed to save:', error);
      }
    }

    recordSelection(itemId, imageType, taskHint) {
      if (!this.usageStats.clickCountByItemId[itemId]) {
        this.usageStats.clickCountByItemId[itemId] = 0;
      }
      this.usageStats.clickCountByItemId[itemId]++;
      this.usageStats.lastSelectedTimestamps[itemId] = Date.now();
      this.saveSettings();
    }

    recencyBoost(timestamp) {
      if (!timestamp) return 0;
      const daysSince = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
      if (daysSince < 1) return 1.0;
      if (daysSince < 7) return 0.7;
      if (daysSince < 30) return 0.4;
      return 0.1;
    }

    contextMatchBoost(lensId, imageType, taskHint) {
      const contextMap = {
        'text': { document: 1.0, screenshot: 0.8, chart: 0.6 },
        'data': { chart: 1.0, document: 0.7, screenshot: 0.5 },
        'people': { photo: 1.0, screenshot: 0.6, meme: 0.8 },
        'layout': { document: 0.8, screenshot: 0.9, photo: 0.7 },
        'objects': { photo: 0.9, product: 1.0, map: 0.7 },
        'ui': { screenshot: 1.0, document: 0.6 }
      };
      const boost = contextMap[lensId]?.[imageType] || 0.5;
      if (taskHint === 'read_text' && lensId === 'text') return 1.0;
      if (taskHint === 'data' && lensId === 'data') return 1.0;
      if (taskHint === 'skim' && lensId === 'layout') return 0.9;
      return boost;
    }

    reorderLensItems(lens, imageType, taskHint) {
      if (!this.enabled) return lens.items;
      const items = [...lens.items];
      const scoredItems = items.map(item => {
        const clickCount = this.usageStats.clickCountByItemId[item.id] || 0;
        const lastSelected = this.usageStats.lastSelectedTimestamps[item.id];
        const finalScore =
          2.0 * (item.salience || 3) +
          1.0 * Math.log(1 + clickCount) +
          0.5 * this.recencyBoost(lastSelected) +
          0.5 * this.contextMatchBoost(lens.id, imageType, taskHint);
        return { item, score: finalScore };
      });
      scoredItems.sort((a, b) => b.score - a.score);
      return scoredItems.map(s => s.item);
    }

    reorderResult(result) {
      if (!this.enabled || !result.lenses) return result;
      const reorderedLenses = result.lenses.map(lens => ({
        ...lens,
        items: this.reorderLensItems(lens, result.imageType, result.taskHint)
      }));
      return { ...result, lenses: reorderedLenses };
    }
  }

  const predictiveOrderer = new PredictiveOrderer();

  // API Client functions
  async function imageToBase64(img) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
        try {
          const base64 = canvas.toDataURL('image/jpeg', 0.9);
          resolve(base64);
        } catch (error) {
          reject(new Error('Failed to convert image to base64: ' + error.message));
        }
      };
      
      img.onerror = () => reject(new Error('Failed to load image'));
      
      if (img.complete && img.naturalHeight !== 0) {
        img.onload();
      }
    });
  }

  function getImageContext(img) {
    const context = [];
    const parent = img.parentElement;
    if (parent) {
      const parentText = parent.textContent?.trim();
      if (parentText && parentText.length > 0 && parentText.length < 500) {
        context.push(parentText);
      }
    }
    let sibling = img.previousElementSibling;
    if (sibling) {
      const siblingText = sibling.textContent?.trim();
      if (siblingText && siblingText.length > 0 && siblingText.length < 300) {
        context.push(siblingText);
      }
    }
    sibling = img.nextElementSibling;
    if (sibling) {
      const siblingText = sibling.textContent?.trim();
      if (siblingText && siblingText.length > 0 && siblingText.length < 300) {
        context.push(siblingText);
      }
    }
    return context.join(' ').substring(0, 500);
  }

  function getPageTitle() {
    return document.title || '';
  }

  function getCacheKey(imageUrl, imageBase64) {
    if (imageBase64) {
      // Simple hash from base64
      let hash = 0;
      for (let i = 0; i < imageBase64.length; i++) {
        const char = imageBase64.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return `base64:${hash}`;
    }
    return `url:${imageUrl}`;
  }

  async function describeImage(img) {
    const imageUrl = img.src || (img instanceof Image ? img.src : null);
    
    if (!imageUrl) {
      throw new Error('No image URL available');
    }
    
    // Check cache
    const cacheKey = getCacheKey(imageUrl, null);
    if (imageDataCache.has(cacheKey)) {
      console.log('[Image Rotor] Cache hit for image:', imageUrl.substring(0, 50));
      return imageDataCache.get(cacheKey);
    }

    isLoading = true;
    updateLoadingState(true);

    try {
      let imageBase64 = null;
      // Only try to convert to base64 if the image is in the DOM and accessible
      // Skip if it's a virtual image object (created from context menu)
      if (!img.isVirtual && img instanceof HTMLImageElement && document.contains(img)) {
        try {
          imageBase64 = await imageToBase64(img);
          console.log('[Image Rotor] Successfully converted image to base64');
        } catch (error) {
          console.warn('[Image Rotor] Failed to convert image to base64 (CORS or other issue), using URL instead:', error.message);
          // Continue with URL - that's fine
        }
      } else {
        console.log('[Image Rotor] Image not in DOM or virtual object, using URL directly');
      }

      const context = img instanceof HTMLImageElement && document.contains(img) ? getImageContext(img) : '';
      const pageTitle = getPageTitle();

      console.log('[Image Rotor] Requesting API call through background script');
      console.log('[Image Rotor] Image URL:', imageUrl.substring(0, 100));
      
      // Use background script to proxy the API call (bypasses CORS)
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'describeImage',
          payload: {
            imageUrl: imageBase64 ? null : imageUrl,
            imageBase64: imageBase64,
            context: context,
            pageTitle: pageTitle
          }
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(`Background script error: ${chrome.runtime.lastError.message}`));
          } else if (response && response.success) {
            resolve(response.data);
          } else {
            // Provide more detailed error message
            const errorMsg = response?.error || 'Unknown error from background script';
            const errorType = response?.errorType || 'Unknown';
            const error = new Error(errorMsg);
            error.errorType = errorType;
            error.details = response?.details;
            reject(error);
          }
        });
      });

      console.log('[Image Rotor] API response received:', {
        hasAltText: !!response.altText,
        hasLenses: !!response.lenses,
        lensCounts: response.lenses ? {
          objects: response.lenses.objects?.length || 0,
          layout: response.lenses.layout?.length || 0,
          style: response.lenses.style?.length || 0
        } : null
      });
      
      // Transform OpenAI response to our format
      const transformedData = transformOpenAIResponse(response, imageUrl);
      
      // Cache the result
      imageDataCache.set(cacheKey, transformedData);
      
      return transformedData;
    } catch (error) {
      console.error('[Image Rotor] Error describing image:', error);
      console.error('[Image Rotor] Error details:', {
        message: error.message,
        errorType: error.errorType,
        details: error.details,
        stack: error.stack
      });
      
      // Show error to user with more helpful message
      let userMessage = `Error: ${error.message}`;
      
      if (error.errorType === 'ImageAccess') {
        userMessage = `Cannot access image. The image may be blocked by CORS or require authentication. Try right-clicking the image and selecting "Analyze with Image Rotor" instead.`;
      } else if (error.errorType === 'Network') {
        userMessage = `Network error. Make sure the server is running at ${API_BASE_URL} and check your internet connection.`;
      } else if (error.errorType === 'Configuration') {
        userMessage = `Server configuration error: ${error.message}`;
      } else if (error.errorType === 'RateLimit') {
        userMessage = `OpenAI API rate limit exceeded. Please try again in a few moments.`;
      }
      
      // Show error to user
      if (rotorPanel) {
        const altTextEl = rotorPanel.querySelector('.ir-alt-text');
        if (altTextEl) {
          altTextEl.textContent = userMessage;
          altTextEl.style.color = '#ef4444';
        }
      }
      
      // Return fallback data
      return createFallbackData(imageUrl, img.alt);
    } finally {
      isLoading = false;
      updateLoadingState(false);
    }
  }

  function transformOpenAIResponse(data, imageUrl) {
    console.log('[Image Rotor] Transforming response:', data);
    
    // Handle new RotorResult format (lenses as array) or legacy format
    let result;
    
    if (Array.isArray(data.lenses)) {
      // New format: RotorResult with lenses array
      result = {
        altText: data.altText || 'Image description unavailable',
        imageText: data.imageText || [],
        imageUrl: imageUrl,
        imageType: data.imageType || 'unknown',
        taskHint: data.taskHint || 'general',
        lenses: data.lenses.map(lens => ({
          id: lens.id,
          label: lens.label,
          items: lens.items.map(item => ({
            id: item.id,
            label: item.label,
            focusSummary: item.focusSummary || item.label,
            description: item.description || `Description for ${item.label}`,
            regionHint: item.regionHint || 'center',
            regionHintCoords: item.regionHintCoords || parseRegionHint(item.regionHint || 'center'),
            confidence: item.confidence || 'medium',
            evidence: item.evidence,
            salience: item.salience || 3,
          }))
        }))
      };
    } else if (data.lenses && typeof data.lenses === 'object') {
      // Legacy format: lenses as object with keys
      const lenses = {};
      lensOrder = [];
      lensLabels = {};
      lensDescriptions = {};
      
      for (const [lensKey, lensData] of Object.entries(data.lenses)) {
        let items = [];
        let name = lensKey;
        let description = '';
        
        if (lensData && typeof lensData === 'object' && lensData.items) {
          items = lensData.items || [];
          name = lensData.name || lensKey;
          description = lensData.description || '';
        } else if (Array.isArray(lensData)) {
          items = lensData;
          const defaultNames = { objects: 'Objects', layout: 'Layout', style: 'Style' };
          name = defaultNames[lensKey] || lensKey;
          description = 'Explore items in this category';
        }
        
        const itemDetails = data.itemDetails || {};
        lenses[lensKey] = items.map((label, index) => {
          const details = itemDetails[label] || {
            description: `Description for ${label}`,
            regionHint: 'center'
          };
          return {
            id: `${lensKey}-${index}`,
            label: label,
            focusSummary: label,
            description: details.description,
            regionHint: details.regionHint || 'center',
            regionHintCoords: parseRegionHint(details.regionHint || 'center'),
            confidence: 'medium',
            salience: 3
          };
        });
        
        lensOrder.push(lensKey);
        lensLabels[lensKey] = name;
        lensDescriptions[lensKey] = description;
      }
      
      result = {
        altText: data.altText || 'Image description unavailable',
        imageText: data.imageText || [],
        imageUrl: imageUrl,
        imageType: data.imageType || 'unknown',
        taskHint: data.taskHint || 'general',
        lenses: lensOrder.map(key => ({
          id: key,
          label: lensLabels[key],
          items: lenses[key] || []
        }))
      };
    } else {
      // Fallback
      result = {
        altText: data.altText || 'Image description unavailable',
        imageText: data.imageText || [],
        imageUrl: imageUrl,
        imageType: 'unknown',
        taskHint: 'general',
        lenses: []
      };
    }
    
    // Update lens configuration from result
    lensOrder = result.lenses.map(l => l.id);
    lensLabels = {};
    lensDescriptions = {};
    result.lenses.forEach(lens => {
      lensLabels[lens.id] = lens.label;
      lensDescriptions[lens.id] = lens.label; // Use label as description if not provided
    });
    
    // Apply predictive ordering
    result = predictiveOrderer.reorderResult(result);
    
    console.log('[Image Rotor] Transformed data:', {
      altText: result.altText.substring(0, 50),
      imageType: result.imageType,
      taskHint: result.taskHint,
      lensCount: result.lenses.length,
      lensNames: result.lenses.map(l => l.label)
    });
    
    return result;
  }

  function parseRegionHint(hint) {
    const hints = {
      'top-left': { x: 10, y: 10, width: 30, height: 30 },
      'top-center': { x: 35, y: 10, width: 30, height: 30 },
      'top-right': { x: 60, y: 10, width: 30, height: 30 },
      'left': { x: 10, y: 35, width: 30, height: 30 },
      'center': { x: 35, y: 35, width: 30, height: 30 },
      'right': { x: 60, y: 35, width: 30, height: 30 },
      'bottom-left': { x: 10, y: 60, width: 30, height: 30 },
      'bottom-center': { x: 35, y: 60, width: 30, height: 30 },
      'bottom-right': { x: 60, y: 60, width: 30, height: 30 },
      'top': { x: 35, y: 5, width: 30, height: 25 },
      'bottom': { x: 35, y: 70, width: 30, height: 25 },
      'far': { x: 70, y: 5, width: 25, height: 40 }
    };
    return hints[hint?.toLowerCase()] || { x: 35, y: 35, width: 30, height: 30 };
  }

  function createFallbackData(imageUrl, altText) {
    // Reset to default lenses for fallback
    lensOrder = ['objects', 'layout', 'style'];
    lensLabels = { objects: 'Objects', layout: 'Layout', style: 'Style' };
    lensDescriptions = { 
    objects: 'Physical things in the image',
    layout: 'Spatial organization',
    style: 'Visual qualities'
  };

    return {
      altText: altText || 'Image description unavailable',
      imageText: [],
      imageUrl: imageUrl,
      imageType: 'unknown',
      taskHint: 'general',
      lenses: [
        { id: 'objects', label: 'Objects', items: [] },
        { id: 'layout', label: 'Layout', items: [] },
        { id: 'style', label: 'Style', items: [] }
      ]
    };
  }

  function updateSpeakingIndicator(speaking) {
    const indicator = document.querySelector('.ir-speaking-indicator');
    if (indicator) {
      indicator.classList.toggle('ir-active', speaking);
    }
    const statusDot = document.querySelector('.ir-status-tts .ir-status-dot');
    if (statusDot) {
      statusDot.classList.toggle('ir-active', speaking);
    }
  }

  function updateLoadingState(loading) {
    if (!rotorPanel) return;
    
    const altTextEl = rotorPanel.querySelector('.ir-alt-text');
    if (altTextEl) {
      if (loading) {
        altTextEl.textContent = 'Analyzing image...';
        altTextEl.style.opacity = '0.6';
      } else {
        altTextEl.style.opacity = '1';
      }
    }
  }

  // Create the rotor panel UI
  async function createRotorPanel(img) {
    const imageUrl = img.src || (img.isVirtual ? img.src : null);
    console.log('[Image Rotor] createRotorPanel called for image:', imageUrl?.substring(0, 100));
    removeRotorPanel();
    currentImage = img;
    hasSpokenAltText = false;

    // Show loading state
    isLoading = true;
    updateLoadingState(true);

    // Create panel with loading state
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
            <p class="ir-alt-text">Analyzing image...</p>
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
            <kbd>Enter</kbd> Select / Drill down
            <span class="ir-hint-sep">·</span>
            <kbd>Backspace</kbd> Drill up
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
                <span class="ir-lens-label">Loading...</span>
                <span class="ir-lens-desc">Analyzing image...</span>
              </div>
              <button class="ir-btn ir-btn-icon ir-lens-next" aria-label="Next lens">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
            </div>
            <div class="ir-lens-indicators">
              <!-- Will be populated dynamically -->
            </div>
            <div class="ir-breadcrumb" style="display: none; padding: 8px 12px; font-size: 11px; color: var(--ir-text-muted); border-bottom: 1px solid var(--ir-border);"></div>
            <ul class="ir-items-list" role="listbox" aria-label="Rotor items"></ul>
            <div class="ir-items-count"></div>
          </div>
          
          <div class="ir-image-container">
            <img src="${imageUrl}" alt="${escapeHtml(img.alt || '')}" class="ir-image" />
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

    // Attach event listeners
    attachPanelListeners(panel);

    // Load image data from API
    console.log('[Image Rotor] Starting API call to describe image...');
    try {
      const imageData = await describeImage(img);
      console.log('[Image Rotor] API call successful, received data:', {
        altText: imageData.altText?.substring(0, 50),
        imageType: imageData.imageType,
        taskHint: imageData.taskHint,
        lensCount: imageData.lenses?.length || 0,
        hasText: imageData.imageText?.length > 0
      });
      
    panel.imageData = imageData;

      // Set current lens to first available lens
      if (lensOrder.length > 0) {
        currentLens = lensOrder[0];
        focusedIndex = 0;
      }
      
      // Update alt text
      const altTextEl = panel.querySelector('.ir-alt-text');
      if (altTextEl) {
        altTextEl.textContent = imageData.altText;
      }
      
      // Update lens UI with dynamic data
      updateLensUI();
      
      // Render items
      renderItems();
      
      // Announce and speak alt text (once)
      if (!hasSpokenAltText && imageData.altText) {
    announce(imageData.altText);
        ttsManager.speak(imageData.altText, { interrupt: false, debounceMs: 0 });
        hasSpokenAltText = true;
      }
    } catch (error) {
      console.error('[Image Rotor] Failed to load image data:', error);
      console.error('[Image Rotor] Error stack:', error.stack);
      // Panel already created, just show error state
      const altTextEl = panel.querySelector('.ir-alt-text');
      if (altTextEl) {
        altTextEl.textContent = `Error: ${error.message}`;
        altTextEl.style.color = '#ef4444';
      }
    }

    // Focus the panel
    panel.focus();
  }

  function updateLensUI() {
    if (!rotorPanel) return;
    
    const lensLabelEl = rotorPanel.querySelector('.ir-lens-label');
    const lensDescEl = rotorPanel.querySelector('.ir-lens-desc');
    const lensIndicatorsEl = rotorPanel.querySelector('.ir-lens-indicators');
    
    if (lensLabelEl && currentLens && lensLabels[currentLens]) {
      lensLabelEl.textContent = lensLabels[currentLens];
    }
    
    if (lensDescEl && currentLens && lensDescriptions[currentLens]) {
      lensDescEl.textContent = lensDescriptions[currentLens];
    }
    
    if (lensIndicatorsEl && lensOrder.length > 0) {
      lensIndicatorsEl.innerHTML = lensOrder.map(lens => 
        `<div class="ir-lens-dot ${lens === currentLens ? 'ir-active' : ''}" data-lens="${lens}"></div>`
      ).join('');
    }
  }

  function renderItems() {
    if (!rotorPanel || !rotorPanel.imageData) return;
    
    const imageData = rotorPanel.imageData;
    let items = [];
    let breadcrumbText = '';
    
    if (isDrilledDown && drillDownStack.length > 0) {
      // Show sub-items of the most recent parent
      const parentState = drillDownStack[drillDownStack.length - 1];
      items = parentState.item.subItems || [];
      breadcrumbText = `Details of: ${parentState.item.label}`;
    } else {
      // Show regular items
      const currentLensObj = imageData.lenses?.find(l => l.id === currentLens);
      items = currentLensObj?.items || [];
      breadcrumbText = '';
    }
    
    const listEl = rotorPanel.querySelector('.ir-items-list');
    const countEl = rotorPanel.querySelector('.ir-items-count');
    const breadcrumbEl = rotorPanel.querySelector('.ir-breadcrumb');
    
    if (!listEl || !countEl) return;
    
    // Update breadcrumb
    if (breadcrumbEl) {
      if (breadcrumbText) {
        breadcrumbEl.textContent = breadcrumbText;
        breadcrumbEl.style.display = 'block';
      } else {
        breadcrumbEl.style.display = 'none';
      }
    }
    
    listEl.innerHTML = items.map((item, index) => {
      const isFocused = index === focusedIndex && isRotorFocused;
      const isSelected = selectedItem?.id === item.id;
      const confidenceClass = item.confidence === 'low' ? 'ir-low-confidence' : 
                             item.confidence === 'medium' ? 'ir-medium-confidence' : '';
      
      // Add uncertainty marker to label for low/medium confidence
      let displayLabel = item.label;
      if (item.confidence === 'low' || item.confidence === 'medium') {
        // Add (likely) suffix for uncertain items
        if (!displayLabel.includes('(likely)') && !displayLabel.startsWith('~')) {
          displayLabel = `${displayLabel} (likely)`;
        }
      }
      
      // Include focusSummary in aria-label for better screen reader skimming
      // For text items, prioritize showing the actual text content
      let ariaLabel = displayLabel;
      if (item.focusSummary) {
        // For text lens, include the actual text prominently
        if (currentLens === 'text' && item.label.includes("'")) {
          const textMatch = item.label.match(/'([^']+)'/);
          if (textMatch) {
            ariaLabel = `Text: ${textMatch[1]}. ${item.focusSummary}`;
          } else {
            ariaLabel = `${displayLabel}. ${item.focusSummary}`;
          }
        } else {
          ariaLabel = `${displayLabel}. ${item.focusSummary}`;
        }
      }
      // Add uncertainty audio cue for low/medium confidence (only in aria-label, not spoken separately)
      if ((item.confidence === 'low' || item.confidence === 'medium') && !ariaLabel.includes('Likely inferred')) {
        ariaLabel = `${ariaLabel}. Likely inferred.`;
      }
      ariaLabel = escapeHtml(ariaLabel);
      
      return `
      <li class="ir-item-wrapper">
        <button 
          class="ir-item ${isFocused ? 'ir-focused' : ''} ${isSelected ? 'ir-selected' : ''} ${confidenceClass}"
          data-index="${index}"
          data-id="${item.id}"
          role="option"
          aria-selected="${isSelected}"
          aria-label="${ariaLabel}"
          title="${item.focusSummary || item.label}"
        >
          <span class="ir-item-number" aria-hidden="true">${index + 1}</span>
          <span class="ir-item-content">
            <span class="ir-item-label">${escapeHtml(displayLabel)}</span>
            ${item.focusSummary ? `<span class="ir-item-summary" aria-hidden="true">${escapeHtml(item.focusSummary)}</span>` : ''}
            ${currentLens === 'text' && (item.label.includes("'") || item.focusSummary?.includes("'")) ? (() => {
              const textMatch = item.label.match(/'([^']+)'/) || item.focusSummary?.match(/'([^']+)'/);
              return textMatch ? `<span class="ir-item-text-preview" aria-hidden="true">${escapeHtml(textMatch[1])}</span>` : '';
            })() : ''}
          </span>
        </button>
      </li>
    `;
    }).join('');
    
    const lensName = lensLabels[currentLens] || currentLens;
    const currentPosition = items.length > 0 ? focusedIndex + 1 : 0;
    countEl.textContent = items.length > 0 
      ? `${currentPosition} of ${items.length} in ${lensName.toLowerCase()}`
      : `No items in ${lensName.toLowerCase()}`;
    
    // Update lens UI
    updateLensUI();
    
    // Update rotor status
    const rotorStatus = rotorPanel.querySelector('.ir-status-rotor');
    if (rotorStatus) {
      const dot = rotorStatus.querySelector('.ir-status-dot');
      if (dot) dot.classList.toggle('ir-active', isRotorFocused);
      const textNode = rotorStatus.childNodes[1];
      if (textNode) textNode.textContent = isRotorFocused ? ' Rotor Active' : ' Rotor Inactive';
    }
    
    // Update rotor panel border
    const rotor = rotorPanel.querySelector('.ir-rotor');
    if (rotor) {
      rotor.classList.toggle('ir-rotor-focused', isRotorFocused);
    }
  }

  function selectItem(item) {
    selectedItem = item;
    
    // Record selection for predictive ordering
    if (item && rotorPanel?.imageData) {
      predictiveOrderer.recordSelection(
        item.id,
        rotorPanel.imageData.imageType,
        rotorPanel.imageData.taskHint
      );
    }
    
    const detailEmpty = rotorPanel.querySelector('.ir-detail-empty');
    const detailContent = rotorPanel.querySelector('.ir-detail-content');
    
    if (item) {
      if (detailEmpty) detailEmpty.style.display = 'none';
      if (detailContent) detailContent.style.display = 'block';
      
      const titleEl = rotorPanel.querySelector('.ir-detail-title');
      const descEl = rotorPanel.querySelector('.ir-detail-description');
      
      if (titleEl) titleEl.textContent = item.label;
      if (descEl) descEl.textContent = item.description;
      
      // Show region overlay (only for parent items, not sub-items)
      if (!isDrilledDown) {
        const coords = item.regionHintCoords || parseRegionHint(item.regionHint);
        if (coords) {
        const overlay = rotorPanel.querySelector('.ir-region-overlay');
          if (overlay) {
        overlay.style.display = 'block';
            overlay.style.left = `${coords.x}%`;
            overlay.style.top = `${coords.y}%`;
            overlay.style.width = `${coords.width}%`;
            overlay.style.height = `${coords.height}%`;
          }
      } else {
          const overlay = rotorPanel.querySelector('.ir-region-overlay');
          if (overlay) overlay.style.display = 'none';
        }
      } else {
        // Hide overlay when viewing sub-items
        const overlay = rotorPanel.querySelector('.ir-region-overlay');
        if (overlay) overlay.style.display = 'none';
      }
      
      // Audio: Speak description on selection (can be re-read with second Enter)
      ttsManager.speak(item.description, { interrupt: true, debounceMs: 0 });
      announce(item.description);
      lastSelectedItemId = item.id;
    } else {
      if (detailEmpty) detailEmpty.style.display = 'block';
      if (detailContent) detailContent.style.display = 'none';
      const overlay = rotorPanel.querySelector('.ir-region-overlay');
      if (overlay) overlay.style.display = 'none';
    }
    
    renderItems();
  }

  function navigateLens(direction) {
    if (lensOrder.length === 0 || !rotorPanel?.imageData) return;
    
    // If drilled down, drill up first
    if (isDrilledDown) {
      drillUp();
      return;
    }
    
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
    drillDownStack = []; // Clear drill-down stack when switching lenses
    
    // Get items from lenses array
    const currentLensObj = rotorPanel.imageData.lenses?.find(l => l.id === currentLens);
    const items = currentLensObj?.items || [];
    const lensName = lensLabels[currentLens] || currentLens;
    
    // Lens label speech: Only speak once per lens switch (context anchor)
    if (lastLensSpoken !== currentLens) {
      const lensAnnouncement = `${lensName} lens`;
      announce(lensAnnouncement);
      ttsManager.speak(lensAnnouncement, { interrupt: true, debounceMs: 0 });
      lastLensSpoken = currentLens;
    }
    
    renderItems();
    
    // Hide detail panel
    const detailEmpty = rotorPanel?.querySelector('.ir-detail-empty');
    const detailContent = rotorPanel?.querySelector('.ir-detail-content');
    const overlay = rotorPanel?.querySelector('.ir-region-overlay');
    if (detailEmpty) detailEmpty.style.display = 'block';
    if (detailContent) detailContent.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
  }

  function drillDown(parentItem) {
    if (!parentItem || !parentItem.subItems || parentItem.subItems.length === 0) return;
    
    // Save current state to stack
    const currentLensObj = rotorPanel.imageData?.lenses?.find(l => l.id === currentLens);
    const currentItems = currentLensObj?.items || [];
    drillDownStack.push({
      item: parentItem,
      parentItems: currentItems,
      focusedIndex: focusedIndex
    });
    
    // Switch to sub-items view
    isDrilledDown = true;
    focusedIndex = 0;
    selectedItem = null;
    
    // Announce drill-down
    const announcement = `Drilled down into ${parentItem.label}. ${parentItem.subItems.length} details available.`;
    announce(announcement);
    ttsManager.speak(announcement, { interrupt: true, debounceMs: 0 });
    
    // Render sub-items
    renderItems();
    
    // Speak first sub-item after announcement
    setTimeout(() => {
      if (parentItem.subItems.length > 0) {
        const firstSubItem = parentItem.subItems[0];
        let labelToSpeak = firstSubItem.label;
        if ((firstSubItem.confidence === 'low' || firstSubItem.confidence === 'medium') && !labelToSpeak.includes('(likely)')) {
          labelToSpeak = `${labelToSpeak}. Likely inferred.`;
        }
        announce(labelToSpeak);
        ttsManager.speakDebounced(labelToSpeak);
      }
    }, 1000);
  }
  
  function drillUp() {
    if (drillDownStack.length === 0) return;
    
    // Restore previous state
    const previousState = drillDownStack.pop();
    isDrilledDown = false;
    focusedIndex = previousState.focusedIndex;
    selectedItem = previousState.item;
    
    // Announce drill-up
    const announcement = `Drilled back up to ${previousState.item.label}`;
    announce(announcement);
    ttsManager.speak(announcement, { interrupt: true, debounceMs: 0 });
    
    // Render parent items
    renderItems();
    
    // Re-select the parent item
    selectItem(previousState.item);
  }

  function announce(message) {
    if (!rotorPanel) return;
    const liveRegion = rotorPanel.querySelector('.ir-live-region');
    if (liveRegion) {
    liveRegion.textContent = message;
    }
  }

  function attachPanelListeners(panel) {
    // Close button
    const closeBtn = panel.querySelector('.ir-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', removeRotorPanel);
    }
    
    // Speak alt text button
    const speakBtn = panel.querySelector('.ir-speak-btn');
    if (speakBtn) {
      speakBtn.addEventListener('click', () => {
        if (panel.imageData?.altText) {
          ttsManager.replayLast();
        }
      });
    }
    
    // Detail speak button
    const detailSpeakBtn = panel.querySelector('.ir-detail-speak');
    if (detailSpeakBtn) {
      detailSpeakBtn.addEventListener('click', () => {
        if (selectedItem) {
          const displayDesc = selectedItem.description;
          ttsManager.speak(displayDesc, { interrupt: true, debounceMs: 0 });
        }
      });
    }
    
    // Lens navigation
    const lensPrev = panel.querySelector('.ir-lens-prev');
    const lensNext = panel.querySelector('.ir-lens-next');
    if (lensPrev) lensPrev.addEventListener('click', () => navigateLens('left'));
    if (lensNext) lensNext.addEventListener('click', () => navigateLens('right'));
    
    // Item clicks
    const itemsList = panel.querySelector('.ir-items-list');
    if (itemsList) {
      itemsList.addEventListener('click', (e) => {
      const btn = e.target.closest('.ir-item');
      if (btn) {
        const index = parseInt(btn.dataset.index);
          const currentLensObj = panel.imageData?.lenses?.find(l => l.id === currentLens);
          const items = currentLensObj?.items || [];
        focusedIndex = index;
        selectItem(items[index]);
      }
    });
    }
    
    // Keyboard navigation
    document.addEventListener('keydown', handleKeyDown);
  }


  function handleKeyDown(e) {
    if (!rotorPanel) return;
    
    // Get current items from lenses array
    const currentLensObj = rotorPanel.imageData?.lenses?.find(l => l.id === currentLens);
    const items = currentLensObj?.items || [];
    
    // R toggles rotor focus
    if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      isRotorFocused = !isRotorFocused;
      if (isRotorFocused) {
        const lensName = currentLens && lensLabels[currentLens] ? lensLabels[currentLens] : 'Current';
        // Speak lens label once as context anchor
        if (lastLensSpoken !== currentLens) {
          const lensAnnouncement = `${lensName} lens`;
          announce(lensAnnouncement);
          ttsManager.speak(lensAnnouncement, { interrupt: true, debounceMs: 0 });
          lastLensSpoken = currentLens;
        }
        // Speak first item label only after lens announcement
        setTimeout(() => {
          if (items.length > 0 && items[0]) {
            let labelToSpeak = items[0].label;
            if ((items[0].confidence === 'low' || items[0].confidence === 'medium') && !labelToSpeak.includes('(likely)')) {
              labelToSpeak = `${labelToSpeak}. Likely inferred.`;
            }
            announce(labelToSpeak);
            ttsManager.speakDebounced(labelToSpeak);
          }
        }, 800);
      } else {
        announce('Rotor closed');
        ttsManager.stop();
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
          const item = items[focusedIndex];
          if (item) {
            // Navigation = labels only (per requirements)
            let labelToSpeak = item.label;
            // Add uncertainty cue only if uncertain
            if ((item.confidence === 'low' || item.confidence === 'medium') && !labelToSpeak.includes('(likely)')) {
              labelToSpeak = `${labelToSpeak}. Likely inferred.`;
            }
            announce(labelToSpeak);
            ttsManager.speakDebounced(labelToSpeak);
          }
          renderItems();
        }
        break;
        
      case 'ArrowDown':
        e.preventDefault();
        if (items.length > 0) {
          focusedIndex = focusedIndex === items.length - 1 ? 0 : focusedIndex + 1;
          const item = items[focusedIndex];
          if (item) {
            // Navigation = labels only (per requirements)
            let labelToSpeak = item.label;
            // Add uncertainty cue only if uncertain
            if ((item.confidence === 'low' || item.confidence === 'medium') && !labelToSpeak.includes('(likely)')) {
              labelToSpeak = `${labelToSpeak}. Likely inferred.`;
            }
            announce(labelToSpeak);
            ttsManager.speakDebounced(labelToSpeak);
          }
          renderItems();
        }
        break;
        
      case 'ArrowLeft':
        e.preventDefault();
        navigateLens('left');
        // Speak first item label only after lens name finishes (no focusSummary)
        setTimeout(() => {
          const newLensObj = rotorPanel.imageData?.lenses?.find(l => l.id === currentLens);
          const newItems = newLensObj?.items || [];
          if (newItems.length > 0 && newItems[0]) {
            let labelToSpeak = newItems[0].label;
            if ((newItems[0].confidence === 'low' || newItems[0].confidence === 'medium') && !labelToSpeak.includes('(likely)')) {
              labelToSpeak = `${labelToSpeak}. Likely inferred.`;
            }
            announce(labelToSpeak);
            ttsManager.speakDebounced(labelToSpeak);
          }
        }, 800);
        break;
        
      case 'ArrowRight':
        e.preventDefault();
        navigateLens('right');
        // Speak first item label only after lens name finishes (no focusSummary)
        setTimeout(() => {
          const newLensObj = rotorPanel.imageData?.lenses?.find(l => l.id === currentLens);
          const newItems = newLensObj?.items || [];
          if (newItems.length > 0 && newItems[0]) {
            let labelToSpeak = newItems[0].label;
            if ((newItems[0].confidence === 'low' || newItems[0].confidence === 'medium') && !labelToSpeak.includes('(likely)')) {
              labelToSpeak = `${labelToSpeak}. Likely inferred.`;
            }
            announce(labelToSpeak);
            ttsManager.speakDebounced(labelToSpeak);
          }
        }, 800);
        break;
        
      case 'Enter':
        e.preventDefault();
        const currentItem = items[focusedIndex];
        if (selectedItem && selectedItem.id === currentItem?.id && !isDrilledDown) {
          // Item already selected and has sub-items - drill down
          if (currentItem.subItems && currentItem.subItems.length > 0) {
            drillDown(currentItem);
          } else {
            // No sub-items, re-read description
            ttsManager.speak(selectedItem.description, { interrupt: true, debounceMs: 0 });
            announce(selectedItem.description);
          }
        } else if (isDrilledDown) {
          // In drill-down mode, select sub-item
          selectItem(currentItem);
        } else {
          // Select item
          selectItem(currentItem);
        }
        break;
        
      case 'Backspace':
        if (isDrilledDown) {
          e.preventDefault();
          drillUp();
        }
        break;
    }
  }

  function removeRotorPanel() {
    if (rotorPanel) {
      document.removeEventListener('keydown', handleKeyDown);
      ttsManager.stop();
      rotorPanel.remove();
      rotorPanel = null;
      selectedItem = null;
      focusedIndex = 0;
      isRotorFocused = false;
      hasSpokenAltText = false;
    }
    removeImageSelector();
  }

  // Image selector mode
  function enableImageSelector() {
    isSelectingImage = true;
    document.body.classList.add('ir-selecting');
    
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
      removeImageSelector();
      createRotorPanel(img);
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
    console.log('[Image Rotor] Received message:', message.action);
    try {
    switch (message.action) {
      case 'toggleImageSelector':
          console.log('[Image Rotor] Toggling image selector');
        if (rotorPanel) {
          removeRotorPanel();
        } else if (isSelectingImage) {
          removeImageSelector();
        } else {
          enableImageSelector();
        }
          sendResponse({ success: true });
        break;
        
      case 'openRotor':
          console.log('[Image Rotor] Opening rotor for image:', message.imageUrl?.substring(0, 100));
          // Try to find the image in the DOM
          let img = document.querySelector(`img[src="${message.imageUrl}"]`);
          
          // Also try without query params or with different src formats
          if (!img) {
            const urlObj = new URL(message.imageUrl);
            const baseUrl = urlObj.origin + urlObj.pathname;
            img = Array.from(document.querySelectorAll('img')).find(imgEl => {
              const imgSrc = imgEl.src;
              return imgSrc === message.imageUrl || 
                     imgSrc.startsWith(baseUrl) ||
                     imgEl.getAttribute('src') === message.imageUrl;
            });
          }
          
          if (img) {
            console.log('[Image Rotor] Found image element in DOM, creating panel');
            createRotorPanel(img);
            sendResponse({ success: true });
          } else {
            console.log('[Image Rotor] Image not found in DOM, creating virtual image object');
            // Create a virtual image object that just has the URL
            // We'll use the URL directly in the API call (no base64 conversion)
            const virtualImg = {
              src: message.imageUrl,
              alt: message.altText || '',
              // Mark it as not in DOM so we skip base64 conversion
              isVirtual: true
            };
            createRotorPanel(virtualImg);
            sendResponse({ success: true });
          }
        break;
          
        default:
          console.warn('[Image Rotor] Unknown action:', message.action);
          sendResponse({ success: false, error: 'Unknown action' });
    }
    } catch (error) {
      console.error('[Image Rotor] Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true; // Keep the message channel open for async response
  });
  
  console.log('[Image Rotor] Message listener set up successfully');

})();
