/**
 * Arabic text normalization utilities for Quran matching
 *
 * Normalizes Arabic text by:
 * - Removing diacritics (tashkeel: fatha, damma, kasra, etc.)
 * - Unifying similar Arabic characters (alef variants, yeh variants, etc.)
 * - Removing Quranic symbols and pause marks
 * - Normalizing whitespace
 */

// Diacritics / Tashkeel unicode ranges
const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;

// Quranic pause marks and symbols
const QURANIC_SYMBOLS = /[\u06D6-\u06ED\u06FF\u06D4\u06F0-\u06F9\uFD3E\uFD3F]/g;

// Tatweel (kashida)
const TATWEEL = /\u0640/g;

// Superscript alef
const SUPERSCRIPT_ALEF = /\u0670/g;

// Remove small waw, small yeh, etc.
const QURANIC_MARKS = /[\u06E5\u06E6\u06E7\u06E8\u06E9\u06EA\u06EB\u06EC\u06ED]/g;

/**
 * Normalize Arabic text for comparison
 * @param {string} text - Raw Arabic text
 * @param {boolean} keepSpacing - Preserve original spacing (default: false, trims extra spaces)
 * @returns {string} Normalized text
 */
function normalizeArabic(text, keepSpacing = false) {
  if (!text) return '';

  let normalized = text
    // Remove diacritics
    .replace(DIACRITICS, '')
    // Remove Quranic symbols
    .replace(QURANIC_SYMBOLS, '')
    // Remove tatweel (kashida)
    .replace(TATWEEL, '')
    // Remove superscript alef
    .replace(SUPERSCRIPT_ALEF, '')
    // Remove other Quranic marks
    .replace(QURANIC_MARKS, '');

  // Unify Arabic characters
  normalized = unifyArabic(normalized);

  // Normalize whitespace
  if (!keepSpacing) {
    normalized = normalized.replace(/\s+/g, ' ').trim();
  }

  return normalized;
}

/**
 * Unify similar Arabic characters to a single form
 * @param {string} text - Arabic text
 * @returns {string} Text with unified characters
 */
function unifyArabic(text) {
  return text
    // Alef variants → bare alef (ا)
    .replace(/[أإآٱ]/g, 'ا')

    // Alef with madda above → alef
    .replace(/آ/g, 'ا')

    // Teh marbuta → heh (ـة → ه)
    .replace(/ة/g, 'ه')

    // Yeh variants → bare yeh (ي)
    .replace(/[ىئ]/g, 'ي')

    // Waw with hamza → waw
    .replace(/ؤ/g, 'و')

    // Alef maksura → yeh
    .replace(/ى/g, 'ي')

    // Alef wasla → alef
    .replace(/ٱ/g, 'ا');
}

/**
 * Remove only diacritics (keep other features)
 * @param {string} text - Arabic text
 * @returns {string} Text without diacritics
 */
function removeDiacritics(text) {
  if (!text) return '';
  return text.replace(DIACRITICS, '');
}

/**
 * Check if two Arabic texts are "loosely" equal
 * after full normalization
 * @param {string} a - First text
 * @param {string} b - Second text
 * @returns {boolean}
 */
function looseEqual(a, b) {
  return normalizeArabic(a) === normalizeArabic(b);
}

module.exports = {
  normalizeArabic,
  unifyArabic,
  removeDiacritics,
  looseEqual
};
