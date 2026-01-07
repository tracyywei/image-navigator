/**
 * Type definitions for Image Rotor
 * @typedef {'high' | 'medium' | 'low'} Confidence
 * 
 * @typedef {Object} RotorItem
 * @property {string} id - Stable id, derived from label + lens
 * @property {string} label - Short, skimmable
 * @property {string} focusSummary - <= ~8 words, spoken on focus
 * @property {string} description - 1–3 factual sentences, spoken on select
 * @property {string} [regionHint] - "top-left" | "left" | "center" | "bottom" | "far" | etc
 * @property {Confidence} confidence
 * @property {'visual' | 'text'} [evidence] - Optional evidence type
 * @property {number} salience - 1–5 from AI planner
 * @property {boolean} [verified] - Whether this item has been verified
 * @property {string} [verifiedDescription] - Verified description if available
 * @property {RotorItem[]} [subItems] - Optional sub-items for drill-down navigation
 */

/**
 * @typedef {Object} RotorLens
 * @property {string} id - e.g., "text", "layout", "objects", "data", "people", "ui", "style"
 * @property {string} label - UI label
 * @property {RotorItem[]} items
 */

/**
 * @typedef {'document' | 'chart' | 'screenshot' | 'meme' | 'product' | 'map' | 'art' | 'architecture' | 'landscape' | 'portrait' | 'street' | 'nature' | 'food' | 'event' | 'interior' | 'fashion' | 'sports' | 'wildlife' | 'photo' | 'unknown'} ImageType
 * @typedef {'skim' | 'read_text' | 'data' | 'social' | 'general'} TaskHint
 */

/**
 * @typedef {Object} RotorResult
 * @property {string} altText - 1–2 lines
 * @property {string[]} imageText - Transcribed text strings (no quotes in JSON)
 * @property {ImageType} imageType
 * @property {TaskHint} [taskHint]
 * @property {RotorLens[]} lenses - DYNAMIC order
 */

/**
 * @typedef {Object} PlannerResult
 * @property {ImageType} imageType
 * @property {TaskHint} taskHint
 * @property {boolean} hasText
 * @property {string[]} recommendedLenses - 3–5 only
 * @property {Object<string, {mustInclude?: string[], maxItems: number}>} lensSpecs
 * @property {string[]} globalSalienceHeuristics
 */

