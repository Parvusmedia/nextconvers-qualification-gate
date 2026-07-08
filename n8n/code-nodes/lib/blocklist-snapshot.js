/**
 * Blocklist snapshot — compact customer exclusion index for qualification.
 * One NocoDB row per account (chunked); O(1) Set lookup per lead.
 */

const {
  normalizeName,
  normalizeLinkedinCompanyUrl,
  extractDomain,
  normalizeDocumentId,
} = require('./normalize-company');

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
    return {
      customer_names_normalized: [],
      customer_domains: [],
      customer_linkedin_urls: [],
      name_count: 0,
      domain_count: 0,
      linkedin_count: 0,
      source: '',
      updated_at: '',
    };
  }

  const names = parseJsonArray(record.customer_names_json);
  const domains = parseJsonArray(record.customer_domains_json).map(d => extractDomain(d)).filter(Boolean);
  const linkedinUrls = parseJsonArray(record.customer_linkedin_urls_json)
    .map(u => normalizeLinkedinCompanyUrl(u))
    .filter(Boolean);

  return {
    customer_names_normalized: names,
    customer_domains: [...new Set(domains)],
    customer_linkedin_urls: [...new Set(linkedinUrls)],
    name_count: Number(record.name_count) || names.length,
    domain_count: Number(record.domain_count) || domains.length,
    linkedin_count: Number(record.linkedin_count) || linkedinUrls.length,
    source: record.source || '',
    updated_at: record.updated_at || record.UpdatedAt || '',
  };
}

function isSyncManagedExistingCustomerRow(row) {
  if (row.reason !== 'existing_customer') return false;
  if (row.campaign_name && row.campaign_name !== '') return false;
  if (row.active === false || row.active === 'false' || row.active === 0) return false;

  const matchType = row.match_type || '';
  const entityType = row.entity_type || '';
  if (matchType === 'normalized_name' && entityType === 'company_name') return true;
  if (matchType === 'domain' && entityType === 'company_domain') return true;
  if (matchType === 'linkedin_url' && entityType === 'linkedin_company_url') return true;
  if (matchType === 'exact' && entityType === 'company_document') return true;
  return false;
}

function addIdentityToSnapshotSets(sets, row) {
  if (row.active === false || row.active === 'false' || row.active === 0) return;
  const strength = row.match_strength || 'strong';
  if (strength !== 'strong') return;

  const type = row.identity_type || '';
  const value = String(row.identity_value || '').trim();
  if (!value) return;

  if (type === 'legal_name' || type === 'brand_name' || type === 'alias') {
    sets.names.add(normalizeName(value));
  } else if (type === 'domain') {
    const domain = extractDomain(value);
    if (domain) sets.domains.add(domain);
  } else if (type === 'linkedin_url') {
    const linkedin = normalizeLinkedinCompanyUrl(value);
    if (linkedin) sets.linkedinUrls.add(linkedin);
  } else if (type === 'document_id') {
    const doc = normalizeDocumentId(value);
    if (doc) sets.documents.add(doc);
  }
}

function buildBlocklistSnapshotFromRows(suppressionRows, identityRows) {
  const sets = {
    names: new Set(),
    domains: new Set(),
    linkedinUrls: new Set(),
    documents: new Set(),
  };

  for (const row of suppressionRows || []) {
    if (!isSyncManagedExistingCustomerRow(row)) continue;

    const matchType = row.match_type || '';
    const entityType = row.entity_type || '';
    const value = String(row.entity_value || '').trim();
    if (!value) continue;

    if (matchType === 'normalized_name' || (matchType === 'exact' && entityType === 'company_name')) {
      sets.names.add(normalizeName(value));
    } else if (matchType === 'domain' || entityType === 'company_domain') {
      const domain = extractDomain(value);
      if (domain) sets.domains.add(domain);
    } else if (matchType === 'linkedin_url' || entityType === 'linkedin_company_url') {
      const linkedin = normalizeLinkedinCompanyUrl(value);
      if (linkedin) sets.linkedinUrls.add(linkedin);
    } else if (matchType === 'exact' && entityType === 'company_document') {
      const doc = normalizeDocumentId(value);
      if (doc) sets.documents.add(doc);
    }
  }

  for (const row of identityRows || []) {
    addIdentityToSnapshotSets(sets, row);
  }

  return {
    account_id: '',
    customer_names: [...sets.names],
    customer_domains: [...sets.domains],
    customer_linkedin_urls: [...sets.linkedinUrls],
    customer_document_ids: [...sets.documents],
    name_count: sets.names.size,
    domain_count: sets.domains.size,
    linkedin_count: sets.linkedinUrls.size,
    document_count: sets.documents.size,
    source: 'pipedrive',
  };
}

const MAX_JSON_CHARS = 90000;

function chunkStringArray(items) {
  const chunks = [];
  let current = [];

  for (const item of items) {
    const candidate = [...current, item];
    if (JSON.stringify(candidate).length > MAX_JSON_CHARS && current.length > 0) {
      chunks.push(current);
      current = [item];
    } else {
      current = candidate;
    }
  }

  if (current.length) chunks.push(current);
  return chunks;
}

function buildSnapshotChunkRows(snapshot, source) {
  const accountId = snapshot.account_id;
  const nameChunks = chunkStringArray(snapshot.customer_names || []);
  const domainChunks = chunkStringArray(snapshot.customer_domains || []);
  const linkedinChunks = chunkStringArray(snapshot.customer_linkedin_urls || []);
  const chunkCount = Math.max(nameChunks.length, domainChunks.length, linkedinChunks.length, 1);
  const rows = [];
  const updatedAt = snapshot.updated_at || new Date().toISOString();

  for (let i = 0; i < chunkCount; i += 1) {
    rows.push({
      account_id: accountId,
      chunk_index: i,
      customer_names_json: JSON.stringify(nameChunks[i] || []),
      customer_domains_json: JSON.stringify(domainChunks[i] || []),
      customer_linkedin_urls_json: JSON.stringify(linkedinChunks[i] || []),
      source: source || snapshot.source || 'pipedrive',
      name_count: snapshot.name_count || (snapshot.customer_names || []).length,
      domain_count: snapshot.domain_count || (snapshot.customer_domains || []).length,
      linkedin_count: snapshot.linkedin_count || (snapshot.customer_linkedin_urls || []).length,
      updated_at: updatedAt,
    });
  }

  return rows;
}

function mergeSnapshotChunks(records) {
  const names = new Set();
  const domains = new Set();
  const linkedinUrls = new Set();
  let source = '';
  let updated_at = '';
  let name_count = 0;
  let domain_count = 0;
  let linkedin_count = 0;

  for (const record of records || []) {
    for (const name of parseJsonArray(record.customer_names_json)) names.add(name);
    for (const domain of parseJsonArray(record.customer_domains_json)) {
      const normalized = extractDomain(domain);
      if (normalized) domains.add(normalized);
    }
    for (const url of parseJsonArray(record.customer_linkedin_urls_json)) {
      const normalized = normalizeLinkedinCompanyUrl(url);
      if (normalized) linkedinUrls.add(normalized);
    }
    source = record.source || source;
    updated_at = record.updated_at || updated_at;
    name_count = Number(record.name_count) || name_count;
    domain_count = Number(record.domain_count) || domain_count;
    linkedin_count = Number(record.linkedin_count) || linkedin_count;
  }

  return {
    customer_names_json: JSON.stringify([...names]),
    customer_domains_json: JSON.stringify([...domains]),
    customer_linkedin_urls_json: JSON.stringify([...linkedinUrls]),
    name_count: name_count || names.size,
    domain_count: domain_count || domains.size,
    linkedin_count: linkedin_count || linkedinUrls.size,
    source,
    updated_at,
  };
}

function evaluateBlocklistSnapshot(lead, snapshot) {
  const parsed = parseBlocklistSnapshot(snapshot);
  const matches = [];

  const nameSet = new Set(parsed.customer_names_normalized);
  const domainSet = new Set(parsed.customer_domains);
  const linkedinSet = new Set(parsed.customer_linkedin_urls);

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

function isManualSuppressionRow(row) {
  return !isSyncManagedExistingCustomerRow(row);
}

module.exports = {
  normalizeName,
  extractDomain,
  normalizeLinkedinCompanyUrl,
  parseBlocklistSnapshot,
  buildBlocklistSnapshotFromRows,
  buildSnapshotChunkRows,
  mergeSnapshotChunks,
  evaluateBlocklistSnapshot,
  isManualSuppressionRow,
  isSyncManagedExistingCustomerRow,
};
