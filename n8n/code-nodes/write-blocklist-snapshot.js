// ======================================================
// n8n Code Node - Rebuild account_blocklist_snapshots from suppression_entities
// Mode: Run Once for All Items
// Runs when Pipedrive sync completes (sync_complete === true).
// ======================================================

const MAX_JSON_CHARS = 90000;

function getRecords(resp) {
  if (!resp) return [];
  if (Array.isArray(resp.list)) return resp.list;
  if (Array.isArray(resp.records)) return resp.records;
  if (Array.isArray(resp)) return resp;
  return [];
}

function toPositiveInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

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

function isSyncManagedRow(row) {
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

function addIdentityToSets(sets, row) {
  if (row.active === false || row.active === 'false' || row.active === 0) return;
  if ((row.match_strength || 'strong') !== 'strong') return;
  const type = row.identity_type || '';
  const value = String(row.identity_value || '').trim();
  if (!value) return;
  if (type === 'legal_name' || type === 'brand_name' || type === 'alias') sets.names.add(normalizeName(value));
  if (type === 'domain') {
    const domain = extractDomain(value);
    if (domain) sets.domains.add(domain);
  }
  if (type === 'linkedin_url') {
    const linkedin = normalizeLinkedinCompanyUrl(value);
    if (linkedin) sets.linkedinUrls.add(linkedin);
  }
}

function buildSnapshot(suppressionRows, identityRows, accountId) {
  const sets = { names: new Set(), domains: new Set(), linkedinUrls: new Set() };

  for (const row of suppressionRows) {
    if (!isSyncManagedRow(row)) continue;
    const matchType = row.match_type || '';
    const entityType = row.entity_type || '';
    const value = String(row.entity_value || '').trim();
    if (!value) continue;
    if (matchType === 'normalized_name') sets.names.add(normalizeName(value));
    else if (matchType === 'domain') {
      const domain = extractDomain(value);
      if (domain) sets.domains.add(domain);
    } else if (matchType === 'linkedin_url') {
      const linkedin = normalizeLinkedinCompanyUrl(value);
      if (linkedin) sets.linkedinUrls.add(linkedin);
    }
  }

  for (const row of identityRows || []) addIdentityToSets(sets, row);

  return {
    account_id: accountId,
    customer_names: [...sets.names],
    customer_domains: [...sets.domains],
    customer_linkedin_urls: [...sets.linkedinUrls],
    name_count: sets.names.size,
    domain_count: sets.domains.size,
    linkedin_count: sets.linkedinUrls.size,
    source: 'pipedrive',
    updated_at: new Date().toISOString(),
  };
}

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

function buildChunkRows(snapshot) {
  const nameChunks = chunkStringArray(snapshot.customer_names);
  const domainChunks = chunkStringArray(snapshot.customer_domains);
  const linkedinChunks = chunkStringArray(snapshot.customer_linkedin_urls);
  const chunkCount = Math.max(nameChunks.length, domainChunks.length, linkedinChunks.length, 1);
  const rows = [];
  for (let i = 0; i < chunkCount; i += 1) {
    rows.push({
      account_id: snapshot.account_id,
      chunk_index: i,
      customer_names_json: JSON.stringify(nameChunks[i] || []),
      customer_domains_json: JSON.stringify(domainChunks[i] || []),
      customer_linkedin_urls_json: JSON.stringify(linkedinChunks[i] || []),
      source: snapshot.source,
      name_count: snapshot.name_count,
      domain_count: snapshot.domain_count,
      linkedin_count: snapshot.linkedin_count,
      updated_at: snapshot.updated_at,
    });
  }
  return rows;
}

async function deleteExistingChunks(context, baseUrl, tableId, accountId, headers) {
  const existingResp = await context.helpers.httpRequest({
    method: 'GET',
    url: `${baseUrl}/api/v2/tables/${tableId}/records`,
    qs: { where: `(account_id,eq,${accountId})`, limit: 100 },
    headers: { 'xc-token': headers['xc-token'] },
    json: true,
  });
  const existing = getRecords(existingResp);
  if (!existing.length) return 0;
  await context.helpers.httpRequest({
    method: 'DELETE',
    url: `${baseUrl}/api/v2/tables/${tableId}/records`,
    headers,
    body: existing.map(row => ({ Id: row.Id || row.id })),
    json: true,
  });
  return existing.length;
}

// --- MAIN (n8n) ---
const cfg = $('config1').first().json;
const syncData = $('Sync Suppressions to NocoDB').first().json;
const accountId = cfg.qg_account_id;
const baseUrl = String(cfg.nocodb_base_url || '').replace(/\/$/, '');
const suppressionTableId = cfg.nocodb_suppression_entities_table_id;
const identitiesTableId = cfg.nocodb_company_identities_table_id;
const snapshotTableId = cfg.nocodb_blocklist_snapshots_table_id;
const token = cfg.nocodb_api_token;
const headers = { 'xc-token': token, 'Content-Type': 'application/json' };
const pageSize = toPositiveInt(cfg.nocodb_page_size, 500);
const maxPages = toPositiveInt(cfg.snapshot_rebuild_max_pages, 40);
const where = `(account_id,eq,${accountId})~and(reason,eq,existing_customer)~and(active,eq,true)`;

if (!snapshotTableId) throw new Error('nocodb_blocklist_snapshots_table_id is missing in config1');

const allRows = [];
let offset = 0;
for (let page = 0; page < maxPages; page += 1) {
  const res = await this.helpers.httpRequest({
    method: 'GET',
    url: `${baseUrl}/api/v2/tables/${suppressionTableId}/records`,
    qs: { where, limit: pageSize, offset },
    headers: { 'xc-token': token },
    json: true,
  });
  const batch = getRecords(res);
  allRows.push(...batch);
  if (batch.length < pageSize) break;
  offset += pageSize;
}

let identityRows = [];
if (identitiesTableId) {
  const idResp = await this.helpers.httpRequest({
    method: 'GET',
    url: `${baseUrl}/api/v2/tables/${identitiesTableId}/records`,
    qs: { where: `(account_id,eq,${accountId})~and(active,eq,true)`, limit: 500 },
    headers: { 'xc-token': token },
    json: true,
  });
  identityRows = getRecords(idResp);
}

const snapshot = buildSnapshot(allRows, identityRows, accountId);
const chunkRows = buildChunkRows(snapshot);
const deletedCount = await deleteExistingChunks(this, baseUrl, snapshotTableId, accountId, headers);

let insertedCount = 0;
for (const row of chunkRows) {
  await this.helpers.httpRequest({
    method: 'POST',
    url: `${baseUrl}/api/v2/tables/${snapshotTableId}/records`,
    headers,
    body: row,
    json: true,
  });
  insertedCount += 1;
}

return [{
  json: {
    snapshot_written: true,
    account_id: accountId,
    name_count: snapshot.name_count,
    domain_count: snapshot.domain_count,
    linkedin_count: snapshot.linkedin_count,
    identity_rows_merged: identityRows.length,
    chunk_count: chunkRows.length,
    chunks_deleted: deletedCount,
    chunks_inserted: insertedCount,
    source_rows_scanned: allRows.length,
    sync_complete: syncData.sync_complete === true,
    completed_at: snapshot.updated_at,
  },
}];
