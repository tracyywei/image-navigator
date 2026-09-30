// Image Rotor Content Script
// This injects the rotor UI into web pages with OpenAI Vision integration

(function() {
  'use strict';

  console.log('[Image Rotor] Content script loaded - v2.0 with OpenAI integration');
  console.log('[Image Rotor] Script location:', window.location.href);

  // Configuration
  const API_BASE_URL = 'http://localhost:3001'; // Change this to your backend URL

  // State
  let isSelectingImage = false;
  let rotorPanel = null;
  let selectedItem = null;
  let currentLens = null; // Will be set to first lens dynamically
  let focusedIndex = 0;
  let isRotorFocused = false;
  let hasSpokenAltText = false;
  let lastLensSpoken = null; // Track last lens label spoken to avoid repetition

  // Drill-down navigation state
  let drillDownStack = []; // Stack of {item, focusedIndex} for navigation history
  let isDrilledDown = false; // Whether we're currently viewing sub-items
  
  // Image navigation state
  let imageNavigationMode = false;
  let pageImages = [];
  let focusedImageIndex = -1;
  let imageHighlightOverlay = null;
  const PREFETCH_DELAY_MS = 700;
  let prefetchTimer = null;
  let prefetchedAnalysis = null;

  // Lens configuration - will be populated dynamically from API response
  let lensOrder = [];
  let lensLabels = {};

  class EnhancedTTSManager {
    constructor() {
      this.isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
      this.isSpeaking = false;
      this.lastSpokenText = null;
      this.focusDebounceTimer = null;
      this.focusDebounceDelay = 175;
      this.lastFocusedText = null;
      this.lastSpokenTime = 0;
      this.sameTextThreshold = 1000;
      this.rate = 1.0; // Default speed (1.0 = normal, can go up to 2.0)
      this.loadSpeed();
    }

    async loadSpeed() {
      try {
        const result = await chrome.storage.local.get(['ttsSpeed']);
        if (result.ttsSpeed !== undefined) {
          this.rate = Math.max(0.5, Math.min(2.0, parseFloat(result.ttsSpeed) || 1.0));
        }
      } catch (error) {
        console.warn('[TTS Manager] Failed to load speed:', error);
      }
    }

    async setSpeed(rate) {
      this.rate = Math.max(0.5, Math.min(2.0, parseFloat(rate) || 1.0));
      try {
        await chrome.storage.local.set({ ttsSpeed: this.rate });
        updateSpeedIndicator(this.rate);
      } catch (error) {
        console.warn('[TTS Manager] Failed to save speed:', error);
      }
    }

    increaseSpeed() {
      const newRate = Math.min(2.0, this.rate + 0.25);
      this.setSpeed(newRate);
      announce(`Voice speed ${(newRate * 100).toFixed(0)}%`);
    }

    decreaseSpeed() {
      const newRate = Math.max(0.5, this.rate - 0.25);
      this.setSpeed(newRate);
      announce(`Voice speed ${(newRate * 100).toFixed(0)}%`);
    }

    speak(text, options = {}) {
      if (!this.isSupported || !text || text.trim().length === 0) {
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
        utterance.rate = this.rate; // Use configurable speed
        utterance.pitch = 1;
        utterance.volume = 1;

        utterance.onstart = () => {
          this.isSpeaking = true;
          this.lastSpokenText = text;
          this.lastSpokenTime = Date.now();
          updateSpeakingIndicator(true);
        };

        utterance.onend = utterance.onerror = () => {
          this.isSpeaking = false;
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
      updateSpeakingIndicator(false);
    }

    replayLast() {
      if (this.lastSpokenText) {
        this.speak(this.lastSpokenText, { interrupt: true, debounceMs: 0 });
      }
    }
  }

  const ttsManager = new EnhancedTTSManager();

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
        const result = await chrome.storage.local.get(['predictiveOrdering', this.storageKey]);
        this.enabled = result.predictiveOrdering !== false;
        this.usageStats = result[this.storageKey] || this.usageStats;
      } catch (error) {
        console.warn('[Predictive Orderer] Failed to load:', error);
      }
    }

    async saveSettings() {
      try {
        await chrome.storage.local.set({
          predictiveOrdering: this.enabled,
          [this.storageKey]: this.usageStats
        });
      } catch (error) {
        console.warn('[Predictive Orderer] Failed to save:', error);
      }
    }

    recordSelection(itemId) {
      this.usageStats.clickCountByItemId[itemId] = (this.usageStats.clickCountByItemId[itemId] || 0) + 1;
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
      const scoredItems = lens.items.map(item => {
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
  }

  const predictiveOrderer = new PredictiveOrderer();

  // API Client functions
  function imageToBase64(img) {
    const src = img.currentSrc || img.src;
    const isSameOrigin = src.startsWith('data:') || new URL(src, location.href).origin === location.origin;

    return new Promise((resolve, reject) => {
      const draw = (source) => {
        const width = source.naturalWidth;
        const height = source.naturalHeight;
        if (!width || !height) {
          reject(new Error('Image has no size'));
          return;
        }
        // Match what OpenAI's high-detail mode keeps (fit in 2048px, short side 768px);
        // anything bigger is only extra upload time
        const scale = Math.min(1, 2048 / Math.max(width, height), 768 / Math.min(width, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; // JPEG has no transparency
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        try {
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        } catch (error) {
          reject(new Error('Failed to convert image to base64: ' + error.message));
        }
      };

      // Same-origin images can be drawn straight from the page, with no new download
      if (isSameOrigin && img.complete && img.naturalWidth) {
        draw(img);
        return;
      }

      // Cross-origin images need a CORS-enabled copy. Loading it into a separate element
      // leaves the page's own image alone.
      const copy = new Image();
      copy.crossOrigin = 'anonymous';
      const timeout = setTimeout(() => reject(new Error('Timed out loading image')), 3000);
      copy.onload = () => {
        clearTimeout(timeout);
        draw(copy);
      };
      copy.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Failed to load image with CORS'));
      };
      copy.src = src;
    });
  }

  function getImageContext(img) {
    const context = [];
    
    // Text content of an element, excluding script/style/noscript, with whitespace collapsed
    const extractText = (element) => {
      const clone = element.cloneNode(true);
      clone.querySelectorAll('script, style, noscript').forEach(s => s.remove());
      return clone.textContent.replace(/\s+/g, ' ').trim();
    };
    
    // 1. Check for figure/figcaption (common HTML5 pattern)
    const figure = img.closest('figure');
    if (figure) {
      const figcaption = figure.querySelector('figcaption');
      if (figcaption) {
        const captionText = extractText(figcaption);
        if (captionText) {
          context.push(`[Caption: ${captionText}]`);
        }
      }
    }
    
    // 2. Check for nearby caption-like elements (by class/id)
    const captionSelectors = [
      '[class*="caption"]',
      '[class*="credit"]',
      '[id*="caption"]',
      '.wp-caption-text',
      '.image-caption'
    ];
    
    const parent = img.parentElement;
    if (parent) {
      for (const selector of captionSelectors) {
        const captionElement = parent.querySelector(selector);
        if (captionElement) {
          const captionText = extractText(captionElement);
          if (captionText && captionText.length < 300) {
            context.push(`[Caption: ${captionText}]`);
            break;
          }
        }
      }
    }
    
    // 3. Look for surrounding paragraph text (before and after)
    const findNearestParagraph = (startElement, direction = 'previous') => {
      let current = startElement;
      let depth = 0;
      const maxDepth = 5; // Limit how far we search
      
      while (current && depth < maxDepth) {
        const sibling = direction === 'previous' ? 
          current.previousElementSibling : 
          current.nextElementSibling;
        
        if (sibling) {
          // Check if it's a paragraph or text-containing block element
          if (sibling.matches('p, div[class*="text"], div[class*="paragraph"], blockquote, li')) {
            const text = extractText(sibling);
            if (text.length > 20 && text.length < 400) {
              return text;
            }
          }
          current = sibling;
        } else {
          // Go up one level and continue searching
          current = current.parentElement;
          depth++;
        }
      }
      return null;
    };
    
    // Get preceding paragraph
    const precedingParagraph = findNearestParagraph(img, 'previous');
    if (precedingParagraph) {
      context.push(precedingParagraph);
    }
    
    // Get following paragraph
    const followingParagraph = findNearestParagraph(img, 'next');
    if (followingParagraph) {
      context.push(followingParagraph);
    }
    
    // 4. If no context found, fall back to parent text (but filter out the alt text itself)
    if (context.length === 0 && parent) {
      const parentText = extractText(parent);
      const altText = img.alt || '';
      const filteredText = parentText.replace(altText, '').trim();
      
      if (filteredText.length > 10 && filteredText.length < 500) {
        context.push(filteredText);
      }
    }
    
    // Join and limit total context length
    const finalContext = context.join(' ').substring(0, 600);
    
    console.log('[Image Rotor] Extracted context:', finalContext.substring(0, 100) + '...');
    
    return finalContext;
  }

  function getPageTitle() {
    return document.title || '';
  }

  // Analyses keyed by image URL. Each streams events from the server and keeps
  // everything received so far, so a panel opened mid-analysis (e.g. after a
  // prefetch) replays what already arrived and then follows along.
  const analyses = new Map();

  function getAnalysis(img) {
    let analysis = analyses.get(img.src);
    if (!analysis) {
      analysis = startAnalysis(img);
      analyses.set(img.src, analysis);
    }
    return analysis;
  }

  function startAnalysis(img) {
    const analysis = {
      imageUrl: img.src,
      events: [],
      listeners: new Set(),
      port: null,
      done: false,
      failed: false,
      cancelled: false
    };

    const emit = (event) => {
      analysis.events.push(event);
      if (event.type === 'error' || event.type === 'lensError' || event.type === 'altTextError') {
        analysis.failed = true;
      }
      if (event.type === 'done') {
        analysis.done = true;
        analysis.port?.disconnect();
        // Forget failed analyses so opening the image again retries
        if (analysis.failed && analyses.get(analysis.imageUrl) === analysis) {
          analyses.delete(analysis.imageUrl);
        }
      }
      analysis.listeners.forEach(listener => listener(event));
    };

    (async () => {
      let imageBase64 = null;
      // Only try to convert to base64 if the image is in the DOM and accessible
      // Skip if it's a virtual image object (created from context menu)
      if (!img.isVirtual && img instanceof HTMLImageElement && document.contains(img)) {
        try {
          imageBase64 = await imageToBase64(img);
          console.log('[Image Rotor] Converted image to base64,', Math.round(imageBase64.length / 1024), 'KB');
        } catch (error) {
          console.warn('[Image Rotor] Failed to convert image to base64 (CORS or other issue), using URL instead:', error.message);
          // Continue with URL - the server fetches it
        }
      } else {
        console.log('[Image Rotor] Image not in DOM or virtual object, using URL directly');
      }
      if (analysis.cancelled) return;

      const context = img instanceof HTMLImageElement && document.contains(img) ? getImageContext(img) : '';

      // Use background script to proxy the API call (bypasses CORS)
      const port = chrome.runtime.connect({ name: 'describeImage' });
      analysis.port = port;
      port.onMessage.addListener(emit);
      port.onDisconnect.addListener(() => {
        if (!analysis.done && !analysis.cancelled) {
          emit({ type: 'error', errorType: 'Unknown', message: `Background script error: ${chrome.runtime.lastError?.message || 'disconnected'}` });
          emit({ type: 'done' });
        }
      });
      port.postMessage({
        payload: {
          imageUrl: imageBase64 ? null : analysis.imageUrl,
          imageBase64: imageBase64,
          context: context,
          pageTitle: getPageTitle()
        }
      });
    })();

    return analysis;
  }

  // Stop an unfinished analysis; the server cancels its OpenAI calls when the stream closes
  function cancelAnalysis(analysis) {
    if (!analysis || analysis.done) return;
    analysis.cancelled = true;
    analysis.port?.disconnect();
    if (analyses.get(analysis.imageUrl) === analysis) {
      analyses.delete(analysis.imageUrl);
    }
  }

  function subscribeToAnalysis(analysis, listener) {
    analysis.events.forEach(listener);
    analysis.listeners.add(listener);
    return () => analysis.listeners.delete(listener);
  }

  function transformItem(item) {
    return {
      id: item.id,
      label: item.label,
      focusSummary: item.focusSummary || item.label,
      description: item.description || `Description for ${item.label}`,
      regionHint: item.regionHint || 'center',
      regionHintCoords: item.regionHintCoords || parseRegionHint(item.regionHint || 'center'),
      confidence: item.confidence || 'medium',
      evidence: item.evidence,
      salience: item.salience || 3,
      subItems: Array.isArray(item.subItems) && item.subItems.length > 0 ? item.subItems.map(transformItem) : undefined
    };
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

  function updateSpeedIndicator(rate) {
    const speedBtn = document.querySelector('.ir-speed-btn');
    const speedIndicator = document.querySelector('.ir-speed-indicator');
    if (speedBtn) {
      speedBtn.setAttribute('title', `Voice speed: ${(rate * 100).toFixed(0)}%`);
      speedBtn.setAttribute('aria-label', `Voice speed: ${(rate * 100).toFixed(0)}%`);
    }
    if (speedIndicator) {
      speedIndicator.textContent = `${rate.toFixed(1)}x`;
    }
  }

  function showAltText(panel, altText) {
    panel.imageData.altText = altText;
    const altTextEl = panel.querySelector('.ir-alt-text');
    if (altTextEl) {
      altTextEl.textContent = altText;
      altTextEl.style.opacity = '1';
    }
    // Announce and speak alt text (once)
    if (!hasSpokenAltText) {
      announce(altText);
      ttsManager.speak(altText, { interrupt: false, debounceMs: 0 });
      hasSpokenAltText = true;
    }
  }

  function getErrorMessage(event) {
    switch (event.errorType) {
      case 'ImageAccess':
        return `Cannot access image. The image may be blocked by CORS or require authentication. Try right-clicking the image and selecting "Analyze with Image Rotor" instead.`;
      case 'Network':
        return `Network error. Make sure the server is running at ${API_BASE_URL} and check your internet connection.`;
      case 'Configuration':
        return `Server configuration error: ${event.message}`;
      case 'RateLimit':
        return `OpenAI API rate limit exceeded. Please try again in a few moments.`;
      default:
        return `Error: ${event.message}`;
    }
  }

  // Apply one streamed analysis event to the open panel
  function handleAnalysisEvent(panel, img, event) {
    if (rotorPanel !== panel) return;
    const imageData = panel.imageData;
    const findLens = (id) => imageData.lenses.find(l => l.id === id);

    switch (event.type) {
      case 'altText':
        showAltText(panel, event.altText);
        break;

      case 'altTextError':
        console.warn('[Image Rotor] Alt-text failed:', event.message);
        showAltText(panel, img.alt || 'Alt text unavailable');
        break;

      case 'plan':
        imageData.imageType = event.imageType || 'unknown';
        imageData.taskHint = event.taskHint || 'general';
        imageData.lenses = event.lenses.map(lens => ({ id: lens.id, label: lens.label, items: [], loading: true }));
        lensOrder = imageData.lenses.map(l => l.id);
        lensLabels = Object.fromEntries(imageData.lenses.map(l => [l.id, l.label]));
        currentLens = lensOrder[0];
        focusedIndex = 0;
        renderItems();
        break;

      case 'lens': {
        const lens = findLens(event.lens.id);
        if (!lens) break;
        lens.items = predictiveOrderer.reorderLensItems(
          { id: lens.id, items: event.lens.items.map(transformItem) },
          imageData.imageType,
          imageData.taskHint
        );
        lens.loading = false;
        renderItems();
        // Let the user know if they were waiting on this lens
        if (lens.id === currentLens && isRotorFocused && !isDrilledDown) {
          const message = `${lens.items.length} ${lens.label} items loaded`;
          announce(message);
          ttsManager.speak(message, { interrupt: false, debounceMs: 0 });
        }
        break;
      }

      case 'lensError': {
        console.warn('[Image Rotor] Lens failed:', event.id, event.message);
        const lens = findLens(event.id);
        if (!lens) break;
        lens.loading = false;
        lens.failed = true;
        renderItems();
        break;
      }

      case 'imageText':
        imageData.imageText = event.imageText || [];
        break;

      case 'error': {
        console.error('[Image Rotor] Analysis failed:', event);
        const message = getErrorMessage(event);
        panel.analysisError = message;
        imageData.lenses.forEach(lens => {
          if (lens.loading) {
            lens.loading = false;
            lens.failed = true;
          }
        });
        if (!imageData.altText) {
          const altTextEl = panel.querySelector('.ir-alt-text');
          if (altTextEl) {
            altTextEl.textContent = message;
            altTextEl.style.color = '#ef4444';
            altTextEl.style.opacity = '1';
          }
        }
        announce(message);
        renderItems();
        break;
      }

      case 'done':
        console.log('[Image Rotor] Analysis complete:', {
          imageType: imageData.imageType,
          lensNames: imageData.lenses.map(l => l.label)
        });
        break;
    }
  }

  // Create the rotor panel UI
  async function createRotorPanel(img) {
    const imageUrl = img.src;
    if (!imageUrl) {
      console.error('[Image Rotor] Image has no src property:', img);
      announce('Cannot analyze image: no image source available');
      return;
    }
    console.log('[Image Rotor] createRotorPanel called for image:', imageUrl.substring(0, 100));
    removeRotorPanel();
    hasSpokenAltText = false;

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
            <button class="ir-btn ir-btn-icon ir-speed-btn" aria-label="Voice speed" title="Voice speed: 100%">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 6v6l4 2"></path>
              </svg>
              <span class="ir-speed-indicator">1.0x</span>
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
            <kbd>+</kbd><kbd>-</kbd> Speed
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

    // Stream image data from the API; the panel fills in as each part arrives
    console.log('[Image Rotor] Starting analysis...');
    panel.imageData = {
      altText: null,
      imageText: [],
      imageUrl: imageUrl,
      imageType: 'unknown',
      taskHint: 'general',
      lenses: []
    };
    lensOrder = [];
    lensLabels = {};
    currentLens = null;
    focusedIndex = 0;
    isDrilledDown = false;
    drillDownStack = [];
    renderItems();

    const analysis = getAnalysis(img);
    panel.analysis = analysis;
    panel.unsubscribe = subscribeToAnalysis(analysis, (event) => handleAnalysisEvent(panel, img, event));

    // Focus the panel
    panel.focus();
  }

  function getCurrentLens() {
    return rotorPanel?.imageData?.lenses.find(l => l.id === currentLens);
  }

  // Items currently listed: the open lens, or the sub-items being viewed
  function getVisibleItems() {
    if (isDrilledDown && drillDownStack.length > 0) {
      return drillDownStack[drillDownStack.length - 1].item.subItems || [];
    }
    return getCurrentLens()?.items || [];
  }

  function isUncertain(item) {
    return item.confidence === 'low' || item.confidence === 'medium';
  }

  // Navigation speaks labels only, with a cue when the item is uncertain
  function speakItemLabel(item) {
    let label = item.label;
    if (isUncertain(item) && !label.includes('(likely)')) {
      label = `${label}. Likely inferred.`;
    }
    announce(label);
    ttsManager.speakDebounced(label);
  }

  function hideDetail() {
    rotorPanel.querySelector('.ir-detail-empty').style.display = 'block';
    rotorPanel.querySelector('.ir-detail-content').style.display = 'none';
    rotorPanel.querySelector('.ir-region-overlay').style.display = 'none';
  }

  function updateLensUI() {
    if (!rotorPanel) return;
    
    const lensLabelEl = rotorPanel.querySelector('.ir-lens-label');
    const lensDescEl = rotorPanel.querySelector('.ir-lens-desc');
    const lensIndicatorsEl = rotorPanel.querySelector('.ir-lens-indicators');
    
    if (lensLabelEl && currentLens && lensLabels[currentLens]) {
      lensLabelEl.textContent = lensLabels[currentLens];
    }
    
    if (lensDescEl && currentLens && lensLabels[currentLens]) {
      lensDescEl.textContent = lensLabels[currentLens];
    }
    
    if (lensIndicatorsEl && lensOrder.length > 0) {
      lensIndicatorsEl.innerHTML = lensOrder.map(lens => 
        `<div class="ir-lens-dot ${lens === currentLens ? 'ir-active' : ''}" data-lens="${lens}"></div>`
      ).join('');
    }
  }

  function renderItems() {
    if (!rotorPanel || !rotorPanel.imageData) return;
    
    const items = getVisibleItems();
    const currentLensObj = getCurrentLens();
    const breadcrumbText = isDrilledDown && drillDownStack.length > 0
      ? `Details of: ${drillDownStack[drillDownStack.length - 1].item.label}`
      : '';
    
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
      
      // Add (likely) suffix for uncertain items
      let displayLabel = item.label;
      if (isUncertain(item) && !displayLabel.includes('(likely)') && !displayLabel.startsWith('~')) {
        displayLabel = `${displayLabel} (likely)`;
      }
      
      // Include focusSummary in aria-label for better screen reader skimming.
      // For text items, lead with the quoted text itself.
      let ariaLabel = displayLabel;
      if (item.focusSummary) {
        const textMatch = currentLens === 'text' && item.label.match(/'([^']+)'/);
        ariaLabel = textMatch
          ? `Text: ${textMatch[1]}. ${item.focusSummary}`
          : `${displayLabel}. ${item.focusSummary}`;
      }
      // Uncertainty cue for screen readers (only in aria-label, not spoken separately)
      if (isUncertain(item) && !ariaLabel.includes('Likely inferred')) {
        ariaLabel = `${ariaLabel}. Likely inferred.`;
      }
      ariaLabel = escapeHtml(ariaLabel);
      const textPreview = currentLens === 'text' &&
        (item.label.match(/'([^']+)'/) || item.focusSummary?.match(/'([^']+)'/));
      
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
            ${textPreview ? `<span class="ir-item-text-preview" aria-hidden="true">${escapeHtml(textPreview[1])}</span>` : ''}
          </span>
        </button>
      </li>
    `;
    }).join('');
    
    const lensName = (lensLabels[currentLens] || currentLens || '').toLowerCase();
    const currentPosition = items.length > 0 ? focusedIndex + 1 : 0;
    if (!currentLens) {
      countEl.textContent = rotorPanel.analysisError || 'Analyzing image...';
    } else if (items.length > 0) {
      countEl.textContent = `${currentPosition} of ${items.length} in ${lensName}`;
    } else if (currentLensObj?.loading) {
      countEl.textContent = `Loading ${lensName}...`;
    } else if (currentLensObj?.failed) {
      countEl.textContent = `Could not load ${lensName}`;
    } else {
      countEl.textContent = `No items in ${lensName}`;
    }
    
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
    if (!item) {
      hideDetail();
      renderItems();
      return;
    }

    predictiveOrderer.recordSelection(item.id);

    rotorPanel.querySelector('.ir-detail-empty').style.display = 'none';
    rotorPanel.querySelector('.ir-detail-content').style.display = 'block';
    rotorPanel.querySelector('.ir-detail-title').textContent = item.label;
    rotorPanel.querySelector('.ir-detail-description').textContent = item.description;

    // Show region overlay (only for parent items, not sub-items)
    const overlay = rotorPanel.querySelector('.ir-region-overlay');
    if (isDrilledDown) {
      overlay.style.display = 'none';
    } else {
      const coords = item.regionHintCoords || parseRegionHint(item.regionHint);
      overlay.style.display = 'block';
      overlay.style.left = `${coords.x}%`;
      overlay.style.top = `${coords.y}%`;
      overlay.style.width = `${coords.width}%`;
      overlay.style.height = `${coords.height}%`;
    }

    // Speak description on selection (can be re-read with second Enter)
    ttsManager.speak(item.description, { interrupt: true, debounceMs: 0 });
    announce(item.description);
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
    const step = direction === 'left' ? -1 : 1;
    currentLens = lensOrder[(currentIndex + step + lensOrder.length) % lensOrder.length];
    focusedIndex = 0;
    selectedItem = null;
    drillDownStack = []; // Clear drill-down stack when switching lenses
    
    // Lens label speech: Only speak once per lens switch (context anchor)
    if (lastLensSpoken !== currentLens) {
      const lensName = lensLabels[currentLens] || currentLens;
      const lensAnnouncement = getCurrentLens()?.loading ? `${lensName}, loading` : `${lensName}`;
      announce(lensAnnouncement);
      ttsManager.speak(lensAnnouncement, { interrupt: true, debounceMs: 0 });
      lastLensSpoken = currentLens;
    }

    renderItems();
    hideDetail();
  }

  function drillDown(parentItem) {
    if (!parentItem?.subItems?.length) return;
    
    drillDownStack.push({ item: parentItem, focusedIndex });
    isDrilledDown = true;
    focusedIndex = 0;
    selectedItem = null;
    
    const announcement = `Drilled down into ${parentItem.label}. ${parentItem.subItems.length} details available.`;
    announce(announcement);
    ttsManager.speak(announcement, { interrupt: true, debounceMs: 0 });
    renderItems();
    
    // Speak first sub-item after announcement
    setTimeout(() => speakItemLabel(parentItem.subItems[0]), 1000);
  }
  
  function drillUp() {
    if (drillDownStack.length === 0) return;
    
    const previousState = drillDownStack.pop();
    isDrilledDown = false;
    focusedIndex = previousState.focusedIndex;
    
    const announcement = `Drilled back up to ${previousState.item.label}`;
    announce(announcement);
    ttsManager.speak(announcement, { interrupt: true, debounceMs: 0 });
    
    // Re-select the parent item (this also re-renders the list)
    selectItem(previousState.item);
  }

  function announce(message) {
    // Create live region if it doesn't exist (for announcements outside rotor panel)
    let liveRegion = rotorPanel?.querySelector('.ir-live-region');
    if (!liveRegion) {
      liveRegion = document.querySelector('.ir-global-live-region');
      if (!liveRegion) {
        liveRegion = document.createElement('div');
        liveRegion.className = 'ir-global-live-region';
        liveRegion.setAttribute('aria-live', 'polite');
        liveRegion.setAttribute('aria-atomic', 'true');
        liveRegion.style.cssText = 'position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden;';
        document.body.appendChild(liveRegion);
      }
    }
    liveRegion.textContent = message;
  }


  function playBoundarySound() {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch (error) {
      console.warn('Could not play boundary sound:', error);
    }
  }
  
  // Start keyboard-based image navigation mode
  function startImageNavigation() {
    // Find all images on the page
    pageImages = Array.from(document.querySelectorAll('img')).filter(img => {
      // Filter out very small images (likely icons/decorative)
      // Also ensure image is still in DOM and has valid src
      if (!img || !document.contains(img) || !img.src) return false;
      const rect = img.getBoundingClientRect();
      return rect.width > 50 && rect.height > 50 && !img.src.startsWith('data:');
    });

    if (pageImages.length === 0) {
      announce('No images found on this page');
      return;
    }

    imageNavigationMode = true;
    focusedImageIndex = 0;
    
    // Create highlight overlay if it doesn't exist
    if (!imageHighlightOverlay) {
      imageHighlightOverlay = document.createElement('div');
      imageHighlightOverlay.className = 'ir-image-highlight';
      imageHighlightOverlay.setAttribute('role', 'status');
      imageHighlightOverlay.setAttribute('aria-live', 'polite');
      document.body.appendChild(imageHighlightOverlay);
    }

    // Show hint
    showImageNavigationHint();
    
    // Focus first image
    focusImage(0);
    
    // Add keyboard listener for image navigation
    document.addEventListener('keydown', handleImageNavigationKeys, true);
    
    announce(`Image navigation mode. ${pageImages.length} images found. Use arrow keys to navigate, Enter to analyze, Escape to exit.`);
  }
  
  function showImageNavigationHint() {
    // Remove existing hint if any
    const existingHint = document.querySelector('.ir-image-nav-hint');
    if (existingHint) existingHint.remove();

    const hint = document.createElement('div');
    hint.className = 'ir-image-nav-hint';
    hint.style.cssText = `
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: #141416;
      color: #fafafa;
      padding: 12px 24px;
      border-radius: 8px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      z-index: 2147483647;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      border: 1px solid #27272a;
    `;
    hint.textContent = `Image Navigator: ${pageImages.length} images. Arrow keys to navigate, Enter to analyze, Esc to exit`;
    document.body.appendChild(hint);
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      if (hint.parentNode) {
        hint.style.opacity = '0';
        hint.style.transition = 'opacity 0.3s';
        setTimeout(() => hint.remove(), 300);
      }
    }, 3000);
  }
  
  function focusImage(index) {
    if (index < 0 || index >= pageImages.length) {
      playBoundarySound();
      return;
    }

    focusedImageIndex = index;
    const img = pageImages[index];
    
    if (!img || !document.contains(img)) {
      // Image was removed from DOM, remove from our list
      pageImages = pageImages.filter((_, i) => i !== index);
      if (pageImages.length === 0) {
        stopImageNavigation();
        announce('No images remaining on page');
        return;
      }
      // Adjust index if needed
      if (focusedImageIndex >= pageImages.length) {
        focusedImageIndex = pageImages.length - 1;
      }
      focusImage(focusedImageIndex);
      return;
    }
    
    // Scroll image into view
    img.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Highlight image
    const rect = img.getBoundingClientRect();
    if (imageHighlightOverlay) {
      imageHighlightOverlay.style.display = 'block';
      imageHighlightOverlay.style.left = `${rect.left + window.scrollX}px`;
      imageHighlightOverlay.style.top = `${rect.top + window.scrollY}px`;
      imageHighlightOverlay.style.width = `${rect.width}px`;
      imageHighlightOverlay.style.height = `${rect.height}px`;
    }
    
    // Announce image info
    const altText = img.alt || 'No alt text';
    const position = `${index + 1} of ${pageImages.length}`;
    announce(`Image ${position}: ${altText}`);

    schedulePrefetch(img);
  }

  // Start analyzing an image once the user rests on it, so the rotor is often ready
  // by the time they press Enter. Only one unopened prefetch runs at a time.
  function schedulePrefetch(img) {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(() => {
      if (!imageNavigationMode || analyses.has(img.src)) return;
      cancelUnopenedPrefetch();
      prefetchedAnalysis = getAnalysis(img);
    }, PREFETCH_DELAY_MS);
  }

  function cancelUnopenedPrefetch() {
    clearTimeout(prefetchTimer);
    if (prefetchedAnalysis && prefetchedAnalysis.listeners.size === 0) {
      cancelAnalysis(prefetchedAnalysis);
    }
    prefetchedAnalysis = null;
  }

  function stopImageNavigation() {
    imageNavigationMode = false;
    focusedImageIndex = -1;
    cancelUnopenedPrefetch();

    if (imageHighlightOverlay) {
      imageHighlightOverlay.style.display = 'none';
    }
    
    const hint = document.querySelector('.ir-image-nav-hint');
    if (hint) hint.remove();
    
    document.removeEventListener('keydown', handleImageNavigationKeys, true);
    
    announce('Image navigation mode exited');
  }
  
  function handleImageNavigationKeys(e) {
    if (!imageNavigationMode) return;
    
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault();
        e.stopPropagation();
        if (focusedImageIndex > 0) {
          focusImage(focusedImageIndex - 1);
        } else {
          playBoundarySound();
          announce('First image');
        }
        break;
        
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault();
        e.stopPropagation();
        if (focusedImageIndex < pageImages.length - 1) {
          focusImage(focusedImageIndex + 1);
        } else {
          playBoundarySound();
          announce('Last image');
        }
        break;
        
      case 'Enter': {
        e.preventDefault();
        e.stopPropagation();
        const imgToAnalyze = pageImages[focusedImageIndex];
        if (!imgToAnalyze) break;

        if (!document.contains(imgToAnalyze)) {
          console.error('[Image Rotor] Image no longer available or not in DOM');
          announce('Image no longer available');
          stopImageNavigation();
          break;
        }

        // Fall back to currentSrc, data-src or srcset when src is empty
        if (!imgToAnalyze.src) {
          const fallbackSrc = imgToAnalyze.currentSrc || imgToAnalyze.getAttribute('data-src') || imgToAnalyze.getAttribute('srcset')?.split(' ')[0];
          if (!fallbackSrc) {
            console.error('[Image Rotor] Image has no src property');
            announce('Cannot analyze image: no image source available');
            stopImageNavigation();
            break;
          }
          imgToAnalyze.src = fallbackSrc;
        }

        createRotorPanel(imgToAnalyze)
          .then(stopImageNavigation)
          .catch(error => {
            console.error('[Image Rotor] Error creating rotor panel:', error);
            announce('Error analyzing image: ' + error.message);
            stopImageNavigation();
          });
        break;
      }
        
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        stopImageNavigation();
        break;
    }
  }
  function attachPanelListeners(panel) {
    // Close button
    panel.querySelector('.ir-close-btn').addEventListener('click', removeRotorPanel);
    
    // Speak alt text button
    panel.querySelector('.ir-speak-btn').addEventListener('click', () => {
      if (panel.imageData?.altText) {
        ttsManager.replayLast();
      }
    });
    
    // Speed control button: 1.0x -> 1.25x -> 1.5x -> 1.75x -> 2.0x -> 1.0x (cycle)
    panel.querySelector('.ir-speed-btn').addEventListener('click', () => {
      const newRate = [1.25, 1.5, 1.75, 2.0].find(rate => ttsManager.rate < rate) || 1.0;
      ttsManager.setSpeed(newRate);
      announce(`Voice speed ${(newRate * 100).toFixed(0)}%`);
    });
    
    // Initialize speed indicator
    updateSpeedIndicator(ttsManager.rate);
    
    // Detail speak button
    panel.querySelector('.ir-detail-speak').addEventListener('click', () => {
      if (selectedItem) {
        ttsManager.speak(selectedItem.description, { interrupt: true, debounceMs: 0 });
      }
    });
    
    // Lens navigation
    panel.querySelector('.ir-lens-prev').addEventListener('click', () => navigateLens('left'));
    panel.querySelector('.ir-lens-next').addEventListener('click', () => navigateLens('right'));
    
    // Item clicks
    panel.querySelector('.ir-items-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.ir-item');
      if (!btn) return;
      focusedIndex = parseInt(btn.dataset.index);
      selectItem(getVisibleItems()[focusedIndex]);
    });
    
    // Keyboard navigation
    document.addEventListener('keydown', handleKeyDown);
  }


  function handleKeyDown(e) {
    if (!rotorPanel) return;
    
    const items = getVisibleItems();

    // R toggles rotor focus
    if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      isRotorFocused = !isRotorFocused;
      if (isRotorFocused) {
        const lensName = currentLens && lensLabels[currentLens] ? lensLabels[currentLens] : 'Current';
        if (!currentLens) {
          announce('Still analyzing image');
          ttsManager.speak('Still analyzing image', { interrupt: true, debounceMs: 0 });
        }
        // Speak lens label once as context anchor
        if (lastLensSpoken !== currentLens) {
          const lensAnnouncement = getCurrentLens()?.loading ? `${lensName}, loading` : `${lensName}`;
          announce(lensAnnouncement);
          ttsManager.speak(lensAnnouncement, { interrupt: true, debounceMs: 0 });
          lastLensSpoken = currentLens;
        }
        // Speak first item label only after lens announcement
        setTimeout(() => {
          if (items[0]) speakItemLabel(items[0]);
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
      case 'ArrowDown': {
        e.preventDefault();
        if (items.length === 0) break;
        const nextIndex = focusedIndex + (e.key === 'ArrowUp' ? -1 : 1);
        if (nextIndex < 0 || nextIndex >= items.length) {
          playBoundarySound();
          announce(e.key === 'ArrowUp' ? 'First item' : 'Last item');
          break;
        }
        focusedIndex = nextIndex;
        speakItemLabel(items[focusedIndex]);
        renderItems();
        break;
      }
        
      case 'ArrowLeft':
      case 'ArrowRight':
        e.preventDefault();
        navigateLens(e.key === 'ArrowLeft' ? 'left' : 'right');
        // Speak first item label only after lens name finishes (no focusSummary)
        setTimeout(() => {
          const firstItem = getCurrentLens()?.items[0];
          if (firstItem) speakItemLabel(firstItem);
        }, 800);
        break;
        
      case 'Enter': {
        e.preventDefault();
        const currentItem = items[focusedIndex];
        if (!selectedItem || selectedItem.id !== currentItem?.id || isDrilledDown) {
          selectItem(currentItem);
        } else if (currentItem.subItems?.length > 0) {
          // Item already selected and has sub-items - drill down
          drillDown(currentItem);
        } else {
          // No sub-items, re-read description
          ttsManager.speak(selectedItem.description, { interrupt: true, debounceMs: 0 });
          announce(selectedItem.description);
        }
        break;
      }
        
      case 'Backspace':
        if (isDrilledDown) {
          e.preventDefault();
          drillUp();
        }
        break;
        
      case '+':
      case '=':
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          ttsManager.increaseSpeed();
        }
        break;
        
      case '-':
      case '_':
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          ttsManager.decreaseSpeed();
        }
        break;
    }
  }

  function removeRotorPanel() {
    if (rotorPanel) {
      document.removeEventListener('keydown', handleKeyDown);
      ttsManager.stop();
      // Stop paying for an analysis nobody is waiting on
      rotorPanel.unsubscribe?.();
      if (rotorPanel.analysis?.listeners.size === 0) {
        cancelAnalysis(rotorPanel.analysis);
      }
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
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    removeImageSelector();
    createRotorPanel(img);
  }

  function handleImageHover(e) {
    if (!isSelectingImage) return;
    
    const img = e.target.closest('img');
    if (!img) return;
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

  function handleImageUnhover(e) {
    if (!isSelectingImage) return;
    
    if (!e.target.closest('img')) return;
    const highlight = document.querySelector('.ir-image-highlight');
    if (highlight) highlight.style.display = 'none';
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
      case 'startImageNavigation':
        console.log('[Image Rotor] Starting image navigation mode');
        startImageNavigation();
        sendResponse({ success: true });
        break;
        
      case 'increaseVoiceSpeed':
        ttsManager.increaseSpeed();
        sendResponse({ success: true });
        break;
        
      case 'decreaseVoiceSpeed':
        ttsManager.decreaseSpeed();
        sendResponse({ success: true });
        break;
        
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
          
          if (!img) {
            // Not in the DOM: use a virtual image so the server fetches the URL directly
            console.log('[Image Rotor] Image not found in DOM, creating virtual image object');
            img = { src: message.imageUrl, alt: message.altText || '', isVirtual: true };
          }
          createRotorPanel(img);
          sendResponse({ success: true });
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
