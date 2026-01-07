/**
 * Enhanced TTS Manager with Progressive Summaries
 * Uses Web Speech API with debouncing and interrupt handling
 */

class EnhancedTTSManager {
  constructor() {
    this.isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    this.isSpeaking = false;
    this.lastSpokenText = null;
    this.currentUtterance = null;
    this.focusDebounceTimer = null;
    this.focusDebounceDelay = 175; // 150-200ms range
    this.lastFocusedText = null;
    this.lastSpokenTime = 0;
    this.sameTextThreshold = 1000; // 1 second
    this.enabled = true;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.stop();
    }
  }

  /**
   * Speak text with options
   * @param {string} text - Text to speak
   * @param {Object} options - Options
   * @param {boolean} options.interrupt - Cancel previous speech (default: true)
   * @param {number} options.debounceMs - Debounce delay in ms (default: 0, no debounce)
   */
  speak(text, options = {}) {
    if (!this.isSupported || !this.enabled || !text || text.trim().length === 0) {
      return;
    }

    const { interrupt = true, debounceMs = 0 } = options;

    // Skip if same text was just spoken within threshold
    const now = Date.now();
    if (text === this.lastSpokenText && this.isSpeaking && (now - this.lastSpokenTime) < this.sameTextThreshold) {
      return;
    }

    // Clear any pending debounce
    if (this.focusDebounceTimer) {
      clearTimeout(this.focusDebounceTimer);
      this.focusDebounceTimer = null;
    }

    const doSpeak = () => {
      // Cancel current speech if interrupting
      if (interrupt) {
        this.stop();
      }

      // Create new utterance
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      utterance.pitch = 1;
      utterance.volume = 1;

      // Set up event handlers
      utterance.onstart = () => {
        this.isSpeaking = true;
        this.currentUtterance = utterance;
        this.lastSpokenText = text;
        this.lastSpokenTime = Date.now();
        this.onSpeakingStateChange?.(true);
      };

      utterance.onend = () => {
        this.isSpeaking = false;
        this.currentUtterance = null;
        this.onSpeakingStateChange?.(false);
      };

      utterance.onerror = (error) => {
        console.warn('[TTS Manager] TTS error:', error);
        this.isSpeaking = false;
        this.currentUtterance = null;
        this.onSpeakingStateChange?.(false);
      };

      // Speak
      window.speechSynthesis.speak(utterance);
    };

    // Apply debouncing if requested
    if (debounceMs > 0) {
      // Skip if same text as last focused
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

  /**
   * Speak with debouncing (for focus changes)
   */
  speakDebounced(text) {
    this.speak(text, { debounceMs: this.focusDebounceDelay });
  }

  /**
   * Stop current speech
   */
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
    this.onSpeakingStateChange?.(false);
  }

  /**
   * Get last spoken text
   */
  getLastSpoken() {
    return this.lastSpokenText;
  }

  /**
   * Replay the last spoken text
   */
  replayLast() {
    if (this.lastSpokenText) {
      this.speak(this.lastSpokenText, { interrupt: true, debounceMs: 0 });
    }
  }

  /**
   * Set callback for speaking state changes
   */
  setOnSpeakingStateChange(callback) {
    this.onSpeakingStateChange = callback;
  }
}

// Export singleton instance
if (typeof window !== 'undefined') {
  window.EnhancedTTSManager = EnhancedTTSManager;
}


