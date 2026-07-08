/**
 * Company name and URL normalization for exclusion matching.
 * Generic rules only — no client-specific strings.
 */

function foldAccents(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const LEGAL_SUFFIX_PATTERNS = [
  /\bcorreduria de seguros y reaseguros\b/gi,
  /\bcorreduría de seguros y reaseguros\b/gi,
  /\bcorreduria de seguros\b/gi,
  /\bcorreduría de seguros\b/gi,
  /\bsociedad limitada unipersonal\b/gi,
  /\bsociedad anonima unipersonal\b/gi,
  /\bsociedad limitada\b/gi,
  /\bsociedad anonima\b/gi,
  /\bs\s*l\s*u\b/gi,
  /\bs\s*a\s*u\b/gi,
  /\bslu\b/gi,
  /\bsau\b/gi,
];

function stripLegalSuffixes(text) {
  let value = String(text || '').trim();
  for (let i = 0; i < 4; i += 1) {
    const before = value;
    for (const pattern of LEGAL_SUFFIX_PATTERNS) {
      value = value.replace(pattern, ' ');
    }
    value = value
      .replace(/[,\-–—]+$/g, ' ')
      .replace(/,\s*(s\s*a\s*u|s\s*l\s*u|s\s*l|s\s*a)\s*$/i, ' ')
      .replace(/\s+(s\s*a\s*u|s\s*l\s*u|s\s*l|s\s*a)\s*$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (value === before) break;
  }
  return value;
}

function normalizeName(name) {
  let value = foldAccents(String(name || ''))
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  value = stripLegalSuffixes(value);
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeLinkedinCompanyUrl(url) {
  const s = String(url || '').trim().toLowerCase();
  if (!s) return '';
  try {
    const withProto = s.includes('://') ? s : `https://${s}`;
    const u = new URL(withProto);
    if (!u.hostname.includes('linkedin.com')) return '';
    const match = u.pathname.match(/\/company\/([^/?#]+)/i);
    return match ? `linkedin.com/company/${match[1]}` : '';
  } catch (_e) {
    const match = s.match(/linkedin\.com\/company\/([^/?#]+)/i);
    return match ? `linkedin.com/company/${match[1]}` : '';
  }
}

function extractDomain(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  try {
    const withProto = s.includes('://') ? s : `https://${s}`;
    return new URL(withProto).hostname.replace(/^www\./, '');
  } catch (_e) {
    const parts = s.split('@');
    if (parts.length === 2) return parts[1].split('/')[0].replace(/^www\./, '');
    return s.replace(/^www\./, '').split('/')[0];
  }
}

function normalizeDocumentId(value) {
  return foldAccents(String(value || ''))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

module.exports = {
  foldAccents,
  stripLegalSuffixes,
  normalizeName,
  normalizeLinkedinCompanyUrl,
  extractDomain,
  normalizeDocumentId,
};
