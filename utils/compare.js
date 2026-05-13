/**
 * Quran text matching engine
 *
 * Compares Speechmatics transcription output against the Quran text
 * using normalized Arabic matching and Levenshtein distance.
 */

const { normalizeArabic } = require('./normalizeArabic');

/**
 * Levenshtein distance between two strings
 * @param {string} a
 * @param {string} b
 * @returns {number} Edit distance
 */
function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity percentage based on Levenshtein distance
 * @param {string} a - Normalized string A
 * @param {string} b - Normalized string B
 * @returns {{similarity: number, distance: number, maxLen: number}}
 */
function calculateSimilarity(a, b) {
  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length, 1);
  const similarity = parseFloat(((1 - distance / maxLen) * 100).toFixed(1));
  return { similarity, distance, maxLen };
}

/**
 * Find the best matching Quran verse for a given text segment
 * @param {string} text - Normalized Arabic text from Speechmatics
 * @param {Array} quranData - Full Quran data array
 * @returns {{match: object|null, similarity: number, distance: number, verse: object|null, surah: object|null}}
 */
function findBestMatch(text, quranData) {
  if (!text || text.trim().length < 3) {
    return { match: null, similarity: 0, distance: 0, verse: null, surah: null };
  }

  const normalizedInput = normalizeArabic(text);
  let bestMatch = null;
  let bestScore = 0;
  let bestDistance = Infinity;
  let bestVerse = null;
  let bestSurah = null;

  // Search through all verses in the Quran
  for (const surah of quranData) {
    for (const verse of surah.verses) {
      const normalizedVerse = normalizeArabic(verse.text);

      // Quick check: if lengths are wildly different, skip
      const lenDiff = Math.abs(normalizedInput.length - normalizedVerse.length);
      if (lenDiff > Math.max(normalizedInput.length, normalizedVerse.length) * 0.7) {
        continue; // Skip if length difference > 70%
      }

      // Check if input text is contained within the verse (substring match)
      if (normalizedVerse.includes(normalizedInput) || normalizedInput.includes(normalizedVerse)) {
        const sim = calculateSimilarity(normalizedInput, normalizedVerse);
        if (sim.similarity > bestScore) {
          bestScore = sim.similarity;
          bestDistance = sim.distance;
          bestMatch = normalizeArabic(verse.text);
          bestVerse = verse;
          bestSurah = surah;
        }
        continue;
      }

      // Full similarity calculation
      const sim = calculateSimilarity(normalizedInput, normalizedVerse);

      if (sim.similarity > bestScore) {
        bestScore = sim.similarity;
        bestDistance = sim.distance;
        bestMatch = normalizeArabic(verse.text);
        bestVerse = verse;
        bestSurah = surah;
      }
    }
  }

  return {
    match: bestMatch,
    similarity: bestScore,
    distance: bestDistance,
    verse: bestVerse,
    surah: bestSurah
  };
}

/**
 * Process all transcription segments and match against Quran
 * @param {Array} segments - Speechmatics segments
 * @param {Array} quranData - Full Quran data
 * @returns {Array} Segments enriched with match data
 */
function matchSegmentsWithQuran(segments, quranData) {
  return segments.map((segment, index) => {
    const matchResult = findBestMatch(segment.text, quranData);

    return {
      ...segment,
      index,
      match: {
        text: matchResult.match,
        similarity: matchResult.similarity,
        distance: matchResult.distance,
        surah: matchResult.surah ? {
          id: matchResult.surah.id,
          name: matchResult.surah.name
        } : null,
        verse: matchResult.verse ? {
          id: matchResult.verse.id,
          text: matchResult.verse.text
        } : null
      },
      // Visual status
      status: matchResult.similarity >= 90 ? 'excellent' :
              matchResult.similarity >= 70 ? 'good' :
              matchResult.similarity >= 50 ? 'partial' : 'poor'
    };
  });
}

module.exports = {
  levenshtein,
  calculateSimilarity,
  findBestMatch,
  matchSegmentsWithQuran
};
