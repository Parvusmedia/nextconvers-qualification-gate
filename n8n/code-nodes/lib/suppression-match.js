/**
 * Suppression entity matching against normalized lead fields.
 */

const { normalizeForMatch, containsPattern } = require('./text-match');

function normalizeLinkedinUrl(url) {
  const s = String(url || '').trim().toLowerCase();
  if (!s) return '';
  return s.split('?')[0].replace(/\/$/, '');
}

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDomain(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  try {
    const withProto = s.includes('://') ? s : `https://${s}`;
    const host = new URL(withProto).hostname.replace(/^www\./, '');
    return host;
  } catch (_e) {
    const parts = s.split('@');
    if (parts.length === 2) return parts[1].split('/')[0].replace(/^www\./, '');
    return s.replace(/^www\./, '').split('/')[0];
  }
}

function getLeadFieldValue(lead, entityType) {
  switch (entityType) {
    case 'company_name':
      return lead.company_name || '';
    case 'company_domain':
      return extractDomain(lead.company_linkedin_url || lead.email_enriched || '');
    case 'linkedin_company_url':
      return lead.company_linkedin_url || '';
    case 'person_linkedin_url':
      return lead.linkedin_url || lead.profile_url || '';
    case 'profile_id':
      return lead.profile_id || '';
    case 'headline_keyword':
      return lead.headline || '';
    case 'title_keyword':
      return lead.current_position || lead.headline || '';
    case 'company_industry':
      return lead.company_industry || '';
    case 'company_type':
      return [lead.company_industry, lead.current_company_description, lead.company_name]
        .filter(Boolean)
        .join(' ');
    case 'email_domain':
      return extractDomain(lead.email_enriched || '');
    default:
      return '';
  }
}

function matchSuppression(lead, entity) {
  const entityType = entity.entity_type || '';
  const entityValue = entity.entity_value || '';
  const matchType = entity.match_type || 'exact';
  const leadValue = getLeadFieldValue(lead, entityType);

  if (!entityValue || !leadValue) return false;

  switch (matchType) {
    case 'exact':
      return normalizeForMatch(leadValue) === normalizeForMatch(entityValue);
    case 'contains':
      return containsPattern(leadValue, entityValue);
    case 'domain': {
      const leadDomain = extractDomain(leadValue);
      const entityDomain = extractDomain(entityValue);
      return leadDomain && entityDomain && leadDomain === entityDomain;
    }
    case 'linkedin_url':
      return normalizeLinkedinUrl(leadValue) === normalizeLinkedinUrl(entityValue);
    case 'normalized_name':
      return normalizeName(leadValue) === normalizeName(entityValue);
    default:
      return normalizeForMatch(leadValue) === normalizeForMatch(entityValue);
  }
}

function evaluateSuppressions(lead, suppressions) {
  const matches = [];

  for (const entity of suppressions || []) {
    if (entity.active === false || entity.active === 'false' || entity.active === 0) continue;
    if (matchSuppression(lead, entity)) {
      matches.push({
        id: entity.id,
        entity_type: entity.entity_type,
        entity_value: entity.entity_value,
        match_type: entity.match_type,
        reason: entity.reason || '',
        severity: entity.severity || 'reject',
        campaign_name: entity.campaign_name || '',
      });
    }
  }

  return matches;
}

module.exports = {
  normalizeLinkedinUrl,
  normalizeName,
  extractDomain,
  getLeadFieldValue,
  matchSuppression,
  evaluateSuppressions,
};
