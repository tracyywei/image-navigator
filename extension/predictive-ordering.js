/**
 * Predictive Ordering Module
 * Re-ranks rotor items based on AI salience + local usage stats
 */

class PredictiveOrderer {
  constructor() {
    this.storageKey = 'imageRotor_usageStats';
    this.enabled = true; // Default ON
    this.loadSettings();
  }

  async loadSettings() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.local.get(['predictiveOrdering', this.storageKey]);
        this.enabled = result.predictiveOrdering !== false; // Default true
        this.usageStats = result[this.storageKey] || {
          clickCountByItemId: {},
          lastSelectedTimestamps: {},
          preferredLensOrder: {}
        };
      } else {
        // Fallback to localStorage
        const stored = localStorage.getItem('imageRotor_predictiveOrdering');
        this.enabled = stored !== 'false';
        const stats = localStorage.getItem(this.storageKey);
        this.usageStats = stats ? JSON.parse(stats) : {
          clickCountByItemId: {},
          lastSelectedTimestamps: {},
          preferredLensOrder: {}
        };
      }
    } catch (error) {
      console.warn('[Predictive Orderer] Failed to load settings:', error);
      this.enabled = true;
      this.usageStats = {
        clickCountByItemId: {},
        lastSelectedTimestamps: {},
        preferredLensOrder: {}
      };
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
      console.warn('[Predictive Orderer] Failed to save settings:', error);
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.saveSettings();
  }

  /**
   * Record item selection for usage stats
   */
  recordSelection(itemId, imageType, taskHint) {
    if (!this.usageStats.clickCountByItemId[itemId]) {
      this.usageStats.clickCountByItemId[itemId] = 0;
    }
    this.usageStats.clickCountByItemId[itemId]++;

    this.usageStats.lastSelectedTimestamps[itemId] = Date.now();

    // Track preferred lens order per image type
    if (imageType && taskHint) {
      const key = `${imageType}_${taskHint}`;
      // This is a simple heuristic - in practice you might track actual lens usage
    }

    this.saveSettings();
  }

  /**
   * Calculate recency boost (0-1 scale)
   */
  recencyBoost(timestamp) {
    if (!timestamp) return 0;
    const daysSince = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
    if (daysSince < 1) return 1.0;
    if (daysSince < 7) return 0.7;
    if (daysSince < 30) return 0.4;
    return 0.1;
  }

  /**
   * Context match boost based on image type and task hint
   */
  contextMatchBoost(lensId, imageType, taskHint) {
    // Simple heuristics - can be refined
    const contextMap = {
      'text': { document: 1.0, screenshot: 0.8, chart: 0.6 },
      'data': { chart: 1.0, document: 0.7, screenshot: 0.5 },
      'people': { photo: 1.0, screenshot: 0.6, meme: 0.8 },
      'layout': { document: 0.8, screenshot: 0.9, photo: 0.7 },
      'objects': { photo: 0.9, product: 1.0, map: 0.7 },
      'ui': { screenshot: 1.0, document: 0.6 }
    };

    const boost = contextMap[lensId]?.[imageType] || 0.5;
    
    // Adjust based on task hint
    if (taskHint === 'read_text' && lensId === 'text') return 1.0;
    if (taskHint === 'data' && lensId === 'data') return 1.0;
    if (taskHint === 'skim' && lensId === 'layout') return 0.9;

    return boost;
  }

  /**
   * Re-rank items in a lens based on predictive scoring
   */
  reorderLensItems(lens, imageType, taskHint) {
    if (!this.enabled) {
      return lens.items; // Return original order
    }

    const items = [...lens.items]; // Clone array

    // Calculate final score for each item
    const scoredItems = items.map(item => {
      const clickCount = this.usageStats.clickCountByItemId[item.id] || 0;
      const lastSelected = this.usageStats.lastSelectedTimestamps[item.id];
      
      const finalScore =
        2.0 * item.salience +
        1.0 * Math.log(1 + clickCount) +
        0.5 * this.recencyBoost(lastSelected) +
        0.5 * this.contextMatchBoost(lens.id, imageType, taskHint);

      return { item, score: finalScore };
    });

    // Sort by score descending
    scoredItems.sort((a, b) => b.score - a.score);

    return scoredItems.map(s => s.item);
  }

  /**
   * Re-rank all lenses (maintains lens order, reorders items within each)
   */
  reorderResult(result) {
    if (!this.enabled || !result.lenses) {
      return result;
    }

    const reorderedLenses = result.lenses.map(lens => ({
      ...lens,
      items: this.reorderLensItems(lens, result.imageType, result.taskHint)
    }));

    return {
      ...result,
      lenses: reorderedLenses
    };
  }
}

// Export singleton
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PredictiveOrderer;
}


