/**
 * Parse a config field into a string array.
 * Handles JSON arrays, comma-separated, semicolon-separated, and newline-separated values.
 */
function parseConfigArray(value) {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim()).filter(Boolean);
  }

  const str = String(value).trim();
  if (!str) return [];

  if (str.startsWith('[')) {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) {
        return parsed.map(v => String(v).trim()).filter(Boolean);
      }
    } catch (_e) {
      // fall through to delimiter split
    }
  }

  return str
    .split(/[,;\n]/)
    .map(s => s.trim())
    .filter(Boolean);
}

module.exports = { parseConfigArray };
