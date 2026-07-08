// ======================================================
// n8n Code Node - Merge Context (policy + snapshot + manual suppressions)
// Mode: Run Once for All Items
// ======================================================

function getRecords(resp) {
  if (!resp) return [];
  if (Array.isArray(resp.list)) return resp.list;
  if (Array.isArray(resp.records)) return resp.records;
  if (Array.isArray(resp)) return resp;
  return [];
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

function isManualSuppressionRow(row) {
  return !isSyncManagedExistingCustomerRow(row);
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

const lead = $('Normalize Lead').first().json;
const policyResp = $('Load Campaign Policy').first().json;
const snapshotResp = $('Load Blocklist Snapshot').first().json;
const suppressionsResp = $('Load Manual Suppressions').first().json;
const idempotencyResp = $('Idempotency Lookup').first().json;

const campaignName = lead.campaign_name || '';
const allPolicies = getRecords(policyResp);
const exactRecords = allPolicies.filter(p => p.campaign_name === campaignName);
const defaultRecords = allPolicies.filter(p => p.campaign_name === '__default__');
const policy = exactRecords[0] || defaultRecords[0] || null;

const snapshotRecords = getRecords(snapshotResp).sort(
  (a, b) => Number(a.chunk_index || 0) - Number(b.chunk_index || 0)
);

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(v => String(v).trim()).filter(Boolean) : [];
  } catch (_e) {
    return [];
  }
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

  for (const record of records) {
    for (const name of parseJsonArray(record.customer_names_json)) names.add(name);
    for (const domain of parseJsonArray(record.customer_domains_json)) domains.add(domain);
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

  if (!records.length) return null;

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

const blocklist_snapshot = mergeSnapshotChunks(snapshotRecords);

const suppressionRecords = getRecords(suppressionsResp);
const manualSuppressions = suppressionRecords.filter(s => {
  if (s.active === false || s.active === 'false' || s.active === 0) return false;
  if (!isManualSuppressionRow(s)) return false;
  if (!s.campaign_name || s.campaign_name === '') return true;
  return s.campaign_name === campaignName;
});

const existingRecords = getRecords(idempotencyResp).filter(r => r.campaign_name === campaignName);
const existing = existingRecords[0] || null;

return [{
  json: {
    lead,
    policy,
    blocklist_snapshot,
    suppressions: manualSuppressions,
    existing_decision_id: existing ? (existing.Id || existing.id) : null,
  },
}];
