// ======================================================
// n8n Code Node - Evaluate Hard Rules (config-driven)
// Mode: Run Once for All Items
// Input: lead, policy (parsed), suppressions
// Output: evaluation context object
// ======================================================

// --- lib/parse-config-array.js ---
function parseConfigArray(value) {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  const str = String(value).trim();
  if (!str) return [];
  if (str.startsWith('[')) {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) return parsed.map(v => String(v).trim()).filter(Boolean);
    } catch (_e) { /* fall through */ }
  }
  return str.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
}

// --- lib/text-match.js ---
function foldAccents(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeForMatch(text) {
  return foldAccents(String(text || ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAnyInFields(fields, patterns) {
  if (!patterns || !patterns.length) return false;
  const combined = fields.filter(Boolean).join(' ');
  const h = normalizeForMatch(combined);
  return patterns.some(p => h.includes(normalizeForMatch(p)));
}

function findMatchingPatterns(fields, patterns) {
  const combined = fields.filter(Boolean).join(' ');
  if (!combined || !patterns || !patterns.length) return [];
  const h = normalizeForMatch(combined);
  return patterns.filter(p => h.includes(normalizeForMatch(p)));
}

// --- lib/suppression-match.js ---
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

function normalizeLinkedinUrl(url) {
  return normalizeLinkedinCompanyUrl(url);
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

function getLeadFieldValue(lead, entityType) {
  switch (entityType) {
    case 'company_name': return lead.company_name || '';
    case 'company_domain': return extractDomain(lead.company_linkedin_url || lead.email_enriched || lead.company_website || '');
    case 'linkedin_company_url': return lead.company_linkedin_url || '';
    case 'person_linkedin_url': return lead.linkedin_url || lead.profile_url || '';
    case 'profile_id': return lead.profile_id || '';
    case 'headline_keyword': return lead.headline || '';
    case 'title_keyword': return lead.current_position || lead.headline || '';
    case 'company_industry': return lead.company_industry || '';
    case 'company_type':
      return [lead.company_industry, lead.current_company_description, lead.company_name].filter(Boolean).join(' ');
    case 'email_domain': return extractDomain(lead.email_enriched || '');
    default: return '';
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
      return normalizeForMatch(leadValue).includes(normalizeForMatch(entityValue));
    case 'domain': {
      const ld = extractDomain(leadValue);
      const ed = extractDomain(entityValue);
      return ld && ed && ld === ed;
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

// --- Policy parsing ---
function parsePolicy(policy) {
  const policyId = policy && (policy.Id || policy.id);
  if (!policy || !policyId) return null;
  return {
    ...policy,
    id: policyId,
    allowed_countries: parseConfigArray(policy.allowed_countries),
    excluded_countries: parseConfigArray(policy.excluded_countries),
    allowed_industries: parseConfigArray(policy.allowed_industries),
    excluded_industries: parseConfigArray(policy.excluded_industries),
    target_roles: parseConfigArray(policy.target_roles),
    review_roles: parseConfigArray(policy.review_roles),
    excluded_roles: parseConfigArray(policy.excluded_roles),
    target_departments: parseConfigArray(policy.target_departments),
    excluded_departments: parseConfigArray(policy.excluded_departments),
    target_company_types: parseConfigArray(policy.target_company_types),
    review_company_types: parseConfigArray(policy.review_company_types),
    excluded_company_types: parseConfigArray(policy.excluded_company_types),
    target_keywords: parseConfigArray(policy.target_keywords),
    review_keywords: parseConfigArray(policy.review_keywords),
    excluded_keywords: parseConfigArray(policy.excluded_keywords),
    min_profile_score: Number(policy.min_profile_score) || 0,
    min_company_score: Number(policy.min_company_score) || 0,
    min_company_size: Number(policy.min_company_size) || 0,
    max_company_size: Number(policy.max_company_size) || 0,
    ready_for_crm_profile_score: Number(policy.ready_for_crm_profile_score) || 4,
    ready_for_crm_company_score: Number(policy.ready_for_crm_company_score) || 3,
    auto_ready_threshold: Number(policy.auto_ready_threshold) || 1,
    review_threshold: Number(policy.review_threshold) || 1,
    review_if_profile_score_high_company_score_low:
      policy.review_if_profile_score_high_company_score_low === true ||
      policy.review_if_profile_score_high_company_score_low === 'true' ||
      policy.review_if_profile_score_high_company_score_low === 1,
    require_no_suppression_match:
      policy.require_no_suppression_match === true ||
      policy.require_no_suppression_match === 'true' ||
      policy.require_no_suppression_match === 1,
  };
}

function toBool(val) {
  return val === true || val === 'true' || val === 1 || val === '1';
}

// --- lib/blocklist-snapshot.js (inlined for n8n) ---
function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  const str = String(value).trim();
  if (!str) return [];
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed.map(v => String(v).trim()).filter(Boolean) : [];
  } catch (_e) {
    return [];
  }
}

function parseBlocklistSnapshot(record) {
  if (!record) {
    return { customer_names_normalized: [], customer_domains: [], customer_linkedin_urls: [] };
  }
  const names = parseJsonArray(record.customer_names_json);
  const domains = parseJsonArray(record.customer_domains_json)
    .map(d => extractDomain(d))
    .filter(Boolean);
  const linkedinUrls = parseJsonArray(record.customer_linkedin_urls_json)
    .map(u => normalizeLinkedinCompanyUrl(u))
    .filter(Boolean);
  return {
    customer_names_normalized: names,
    customer_domains: [...new Set(domains)],
    customer_linkedin_urls: [...new Set(linkedinUrls)],
  };
}

function evaluateBlocklistSnapshot(lead, snapshotRecord) {
  const snapshot = parseBlocklistSnapshot(snapshotRecord);
  const matches = [];
  const nameSet = new Set(snapshot.customer_names_normalized);
  const domainSet = new Set(snapshot.customer_domains);
  const linkedinSet = new Set(snapshot.customer_linkedin_urls);
  const leadName = normalizeName(lead.company_name);
  const leadDomain = extractDomain(lead.company_linkedin_url || lead.email_enriched || lead.company_website || '');
  const leadLinkedin = normalizeLinkedinCompanyUrl(lead.company_linkedin_url || '');

  if (leadName && nameSet.has(leadName)) {
    matches.push({
      entity_type: 'company_name',
      entity_value: lead.company_name,
      match_type: 'normalized_name',
      reason: 'existing_customer',
      severity: 'reject',
      campaign_name: '',
      source: 'blocklist_snapshot',
    });
  }

  if (leadDomain && domainSet.has(leadDomain)) {
    matches.push({
      entity_type: 'company_domain',
      entity_value: leadDomain,
      match_type: 'domain',
      reason: 'existing_customer',
      severity: 'reject',
      campaign_name: '',
      source: 'blocklist_snapshot',
    });
  }

  if (leadLinkedin && linkedinSet.has(leadLinkedin)) {
    matches.push({
      entity_type: 'linkedin_company_url',
      entity_value: lead.company_linkedin_url,
      match_type: 'linkedin_url',
      reason: 'existing_customer',
      severity: 'reject',
      campaign_name: '',
      source: 'blocklist_snapshot',
    });
  }

  return matches;
}

function evaluateHardRules(lead, rawPolicy, suppressions, blocklistSnapshot) {
  const ctx = {
    suppression_matches: [],
    risk_flags: [],
    positive_signals: [],
    reject_reasons: [],
    review_reasons: [],
    hard_reject: false,
    suppression_reject: false,
    force_review: false,
    policy_found: false,
  };

  const policy = parsePolicy(rawPolicy);
  if (!policy) {
    ctx.force_review = true;
    ctx.review_reasons.push('No active policy found');
    return ctx;
  }
  ctx.policy_found = true;

  // Suppression check: snapshot (bulk customers) + manual rules
  const snapshotMatches = evaluateBlocklistSnapshot(lead, blocklistSnapshot);
  const manualMatches = evaluateSuppressions(lead, suppressions);
  ctx.suppression_matches = [...snapshotMatches, ...manualMatches];
  const rejectMatches = ctx.suppression_matches.filter(m => m.severity === 'reject');
  const reviewMatches = ctx.suppression_matches.filter(m => m.severity === 'review');

  if (rejectMatches.length > 0) {
    ctx.suppression_reject = true;
    ctx.reject_reasons.push(`Suppression match: ${rejectMatches.map(m => m.reason || m.entity_value).join('; ')}`);
    return ctx;
  }

  for (const m of reviewMatches) {
    ctx.risk_flags.push(`Suppression review: ${m.reason || m.entity_value}`);
  }

  const roleFields = [lead.headline, lead.current_position];
  const companyFields = [lead.company_industry, lead.current_company_description, lead.company_name, lead.summary];

  // Score gates
  if (policy.min_profile_score > 0 && lead.profile_score < policy.min_profile_score) {
    ctx.hard_reject = true;
    ctx.reject_reasons.push(`Profile score ${lead.profile_score} below minimum ${policy.min_profile_score}`);
  }

  if (policy.min_company_score > 0 && lead.company_score < policy.min_company_score) {
    if (policy.review_if_profile_score_high_company_score_low &&
        lead.profile_score >= policy.ready_for_crm_profile_score) {
      ctx.review_reasons.push(`Company score ${lead.company_score} below minimum ${policy.min_company_score} but profile score is high`);
    } else {
      ctx.hard_reject = true;
      ctx.reject_reasons.push(`Company score ${lead.company_score} below minimum ${policy.min_company_score}`);
    }
  }

  if (policy.review_if_profile_score_high_company_score_low &&
      lead.profile_score >= policy.ready_for_crm_profile_score &&
      lead.company_score < policy.ready_for_crm_company_score) {
    ctx.review_reasons.push(`High profile score (${lead.profile_score}) with low company score (${lead.company_score})`);
  }

  // Company size
  if (policy.min_company_size > 0 && lead.current_company_employee_count > 0 &&
      lead.current_company_employee_count < policy.min_company_size) {
    ctx.hard_reject = true;
    ctx.reject_reasons.push(`Company size ${lead.current_company_employee_count} below minimum ${policy.min_company_size}`);
  }

  if (policy.max_company_size > 0 && lead.current_company_employee_count > policy.max_company_size) {
    ctx.review_reasons.push(`Company size ${lead.current_company_employee_count} above maximum ${policy.max_company_size}`);
  }

  // Geography
  const country = normalizeForMatch(lead.country_code || lead.country);
  if (policy.excluded_countries.length && policy.excluded_countries.some(c => normalizeForMatch(c) === country || normalizeForMatch(c) === normalizeForMatch(lead.country))) {
    ctx.hard_reject = true;
    ctx.reject_reasons.push(`Country ${lead.country || lead.country_code} is excluded`);
  }

  if (policy.allowed_countries.length) {
    const allowed = policy.allowed_countries.some(c => {
      const nc = normalizeForMatch(c);
      return nc === country || nc === normalizeForMatch(lead.country);
    });
    if (!allowed) {
      ctx.review_reasons.push(`Country ${lead.country || lead.country_code} not in allowed list`);
    }
  }

  // Industry
  if (policy.excluded_industries.length && containsAnyInFields([lead.company_industry], policy.excluded_industries)) {
    ctx.hard_reject = true;
    ctx.reject_reasons.push(`Industry ${lead.company_industry} is excluded`);
  }

  if (policy.allowed_industries.length && lead.company_industry &&
      !containsAnyInFields([lead.company_industry], policy.allowed_industries)) {
    ctx.review_reasons.push(`Industry ${lead.company_industry} not in allowed list`);
  }

  // Roles and keywords
  const excludedRoleHits = findMatchingPatterns(roleFields, policy.excluded_roles);
  if (excludedRoleHits.length) {
    ctx.hard_reject = true;
    ctx.reject_reasons.push(`Excluded role match: ${excludedRoleHits.join(', ')}`);
  }

  const excludedKeywordHits = findMatchingPatterns([...roleFields, ...companyFields], policy.excluded_keywords);
  if (excludedKeywordHits.length) {
    ctx.hard_reject = true;
    ctx.reject_reasons.push(`Excluded keyword match: ${excludedKeywordHits.join(', ')}`);
  }

  const reviewRoleHits = findMatchingPatterns(roleFields, policy.review_roles);
  if (reviewRoleHits.length) {
    ctx.review_reasons.push(`Review role match: ${reviewRoleHits.join(', ')}`);
  }

  const reviewKeywordHits = findMatchingPatterns([...roleFields, ...companyFields], policy.review_keywords);
  if (reviewKeywordHits.length) {
    ctx.review_reasons.push(`Review keyword match: ${reviewKeywordHits.join(', ')}`);
  }

  const targetRoleHits = findMatchingPatterns(roleFields, policy.target_roles);
  if (targetRoleHits.length) {
    ctx.positive_signals.push(`Target role match: ${targetRoleHits.join(', ')}`);
  }

  const targetKeywordHits = findMatchingPatterns([...roleFields, ...companyFields], policy.target_keywords);
  if (targetKeywordHits.length) {
    ctx.positive_signals.push(`Target keyword match: ${targetKeywordHits.join(', ')}`);
  }

  // Company types
  const excludedCompanyTypeHits = findMatchingPatterns(companyFields, policy.excluded_company_types);
  if (excludedCompanyTypeHits.length) {
    ctx.hard_reject = true;
    ctx.reject_reasons.push(`Excluded company type: ${excludedCompanyTypeHits.join(', ')}`);
  }

  const reviewCompanyTypeHits = findMatchingPatterns(companyFields, policy.review_company_types);
  if (reviewCompanyTypeHits.length) {
    ctx.review_reasons.push(`Review company type: ${reviewCompanyTypeHits.join(', ')}`);
  }

  const targetCompanyTypeHits = findMatchingPatterns(companyFields, policy.target_company_types);
  if (targetCompanyTypeHits.length) {
    ctx.positive_signals.push(`Target company type: ${targetCompanyTypeHits.join(', ')}`);
  }

  // Departments
  const excludedDeptHits = findMatchingPatterns(roleFields, policy.excluded_departments);
  if (excludedDeptHits.length) {
    ctx.hard_reject = true;
    ctx.reject_reasons.push(`Excluded department: ${excludedDeptHits.join(', ')}`);
  }

  const targetDeptHits = findMatchingPatterns(roleFields, policy.target_departments);
  if (targetDeptHits.length) {
    ctx.positive_signals.push(`Target department: ${targetDeptHits.join(', ')}`);
  }

  // Suppression requirement for CRM path
  if (toBool(policy.require_no_suppression_match) && ctx.suppression_matches.length > 0) {
    ctx.risk_flags.push('Suppression match present (require_no_suppression_match)');
  }

  return ctx;
}

// --- MAIN (n8n) ---
return items.map(item => {
  const data = item.json || {};
  const lead = data.lead || data;
  const policy = data.policy || null;
  const suppressions = data.suppressions || [];
  const blocklist_snapshot = data.blocklist_snapshot || null;

  const evaluation = evaluateHardRules(lead, policy, suppressions, blocklist_snapshot);

  return {
    json: {
      lead,
      policy,
      suppressions,
      blocklist_snapshot,
      evaluation,
    },
  };
});
