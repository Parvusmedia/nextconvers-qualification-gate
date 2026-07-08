/**
 * Case-insensitive text matching utilities for ICP evaluation.
 */

const { foldAccents } = require('./normalize-company');

function normalizeForMatch(text) {
  return foldAccents(String(text || ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function containsPattern(haystack, pattern) {
  const h = normalizeForMatch(haystack);
  const p = normalizeForMatch(pattern);
  if (!h || !p) return false;
  return h.includes(p);
}

function containsAny(haystack, patterns) {
  if (!patterns || !patterns.length) return false;
  return patterns.some(p => containsPattern(haystack, p));
}

function containsAnyInFields(fields, patterns) {
  if (!patterns || !patterns.length) return false;
  const combined = fields.filter(Boolean).join(' ');
  return containsAny(combined, patterns);
}

function findMatchingPatterns(fields, patterns) {
  const combined = fields.filter(Boolean).join(' ');
  if (!combined || !patterns || !patterns.length) return [];
  return patterns.filter(p => containsPattern(combined, p));
}

module.exports = {
  normalizeForMatch,
  containsPattern,
  containsAny,
  containsAnyInFields,
  findMatchingPatterns,
};
