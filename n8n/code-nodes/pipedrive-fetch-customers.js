// ======================================================
// n8n Code Node - Fetch Pipedrive customer organizations (batched)
// Mode: Run Once for All Items
// ======================================================

function parseLabelIds(value) {
  return String(value || '')
    .split(/[,;\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
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

function normalizeDocumentId(value) {
  return foldAccents(String(value || ''))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

function orgLabelIds(org) {
  if (Array.isArray(org.label_ids)) return org.label_ids.map(id => String(id));
  if (org.label !== null && org.label !== undefined && org.label !== '') {
    return [String(org.label)];
  }
  return [];
}

function isCustomerOrg(org, mode, labelIds) {
  if (!org || !org.name) return false;
  if (mode === 'all_organizations') return true;
  if (mode === 'label_ids') {
    if (!labelIds.length) return false;
    return labelIds.some(id => orgLabelIds(org).includes(String(id)));
  }
  return false;
}

function getOrgField(org, fieldKey) {
  const key = String(fieldKey || '').trim();
  if (!key) return '';
  const value = org[key];
  if (value === null || value === undefined || value === '') return '';
  return String(value).trim();
}

function getOrgDomain(org, domainFieldKey) {
  const custom = getOrgField(org, domainFieldKey);
  if (custom) return extractDomain(custom);
  if (org.website) return extractDomain(org.website);
  const email = String(org.cc_email || '');
  if (email.includes('@') && !email.endsWith('@pipedrivemail.com')) {
    return extractDomain(email);
  }
  return '';
}

function buildDesiredRows(customers, accountId, fieldKeys) {
  const rows = [];
  const seen = new Set();

  function addRow(row) {
    const key = `${row.entity_type}|${row.match_type}|${String(row.entity_value || '').trim().toLowerCase()}`;
    if (!row.entity_value || seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  }

  for (const org of customers) {
    const name = String(org.name || '').trim();
    if (name) {
      addRow({
        account_id: accountId,
        campaign_name: '',
        entity_type: 'company_name',
        entity_value: name,
        match_type: 'normalized_name',
        reason: 'existing_customer',
        severity: 'reject',
        active: true,
      });
    }

    const domain = getOrgDomain(org, fieldKeys.domain);
    if (domain) {
      addRow({
        account_id: accountId,
        campaign_name: '',
        entity_type: 'company_domain',
        entity_value: domain,
        match_type: 'domain',
        reason: 'existing_customer',
        severity: 'reject',
        active: true,
      });
    }

    const linkedinRaw = getOrgField(org, fieldKeys.linkedin);
    const linkedin = normalizeLinkedinCompanyUrl(linkedinRaw);
    if (linkedin) {
      addRow({
        account_id: accountId,
        campaign_name: '',
        entity_type: 'linkedin_company_url',
        entity_value: linkedinRaw,
        match_type: 'linkedin_url',
        reason: 'existing_customer',
        severity: 'reject',
        active: true,
      });
    }

    const documentId = normalizeDocumentId(getOrgField(org, fieldKeys.document));
    if (documentId) {
      addRow({
        account_id: accountId,
        campaign_name: '',
        entity_type: 'company_document',
        entity_value: documentId,
        match_type: 'exact',
        reason: 'existing_customer',
        severity: 'reject',
        active: true,
      });
    }
  }

  return rows;
}

function getState(staticData) {
  if (!staticData.pipedriveSync) {
    staticData.pipedriveSync = {
      nextStart: 0,
      fetchComplete: false,
      iteration: 0,
      totalOrgsFetched: 0,
      totalCustomersFound: 0,
    };
  }
  return staticData.pipedriveSync;
}

function resetState(staticData) {
  staticData.pipedriveSync = {
    nextStart: 0,
    fetchComplete: false,
    iteration: 0,
    totalOrgsFetched: 0,
    totalCustomersFound: 0,
  };
}

// --- MAIN (n8n) ---
const cfg = $('config1').first().json;
const token = cfg.pipedrive_api_token;
const base = String(cfg.pipedrive_api_base || 'https://api.pipedrive.com/v1').replace(/\/$/, '');
const mode = cfg.pipedrive_customer_mode || 'label_ids';
const labelIds = parseLabelIds(cfg.pipedrive_customer_label_ids);
const accountId = cfg.qg_account_id;
const filterId = String(cfg.pipedrive_filter_id || '').trim();
const pageSize = toPositiveInt(cfg.pipedrive_page_size, 500);
const maxPagesPerRun = toPositiveInt(cfg.pipedrive_max_pages_per_run, 4);
const maxLoopIterations = toPositiveInt(cfg.pipedrive_max_loop_iterations, 20);
const timeBudgetMs = toPositiveInt(cfg.code_time_budget_ms, 45000);
const fieldKeys = {
  domain: cfg.pipedrive_domain_field_key || 'website',
  linkedin: cfg.pipedrive_linkedin_field_key || 'linkedin',
  document: cfg.pipedrive_document_field_key || '48f5c85e7cf48cc71ff63aef91a852c19de4e19b',
};

if (!token) throw new Error('pipedrive_api_token is missing in config1');
if (!accountId) throw new Error('qg_account_id is missing in config1');
if (mode === 'label_ids' && !labelIds.length && !filterId) {
  throw new Error('pipedrive_customer_label_ids is empty. Example: 41,42');
}

const staticData = $getWorkflowStaticData('global');
const state = getState(staticData);
const startedAt = Date.now();

if (state.fetchComplete) {
  resetState(staticData);
}

const batchOrgs = [];
let pagesFetched = 0;
let start = state.nextStart;

while (pagesFetched < maxPagesPerRun) {
  if (Date.now() - startedAt > timeBudgetMs) break;
  if (state.iteration >= maxLoopIterations) break;

  const qs = { api_token: token, start, limit: pageSize };
  if (filterId) qs.filter_id = filterId;

  const res = await this.helpers.httpRequest({
    method: 'GET',
    url: `${base}/organizations`,
    qs,
    json: true,
  });

  if (!res.success) {
    throw new Error(res.error || res.error_info || 'Pipedrive organizations API failed');
  }

  const batch = Array.isArray(res.data) ? res.data : [];
  batchOrgs.push(...batch);
  pagesFetched += 1;
  state.totalOrgsFetched += batch.length;

  const pag = res.additional_data && res.additional_data.pagination;
  if (!pag || !pag.more_items_in_collection) {
    state.fetchComplete = true;
    state.nextStart = 0;
    break;
  }

  start = pag.next_start;
  state.nextStart = start;
}

state.iteration += 1;

const customers = filterId
  ? batchOrgs.filter(org => org && org.name)
  : batchOrgs.filter(org => isCustomerOrg(org, mode, labelIds));

state.totalCustomersFound += customers.length;

const desired_rows = buildDesiredRows(customers, accountId, fieldKeys);

return [{
  json: {
    desired_rows,
    batch_org_count: batchOrgs.length,
    batch_customer_count: customers.length,
    suppression_row_count: desired_rows.length,
    fetch_complete: state.fetchComplete,
    fetch_next_start: state.nextStart,
    pipedrive_pages_fetched: pagesFetched,
    pipedrive_total_orgs_fetched: state.totalOrgsFetched,
    pipedrive_total_customers_found: state.totalCustomersFound,
    pipedrive_iteration: state.iteration,
    pipedrive_filter_id: filterId || null,
    timed_out: Date.now() - startedAt > timeBudgetMs,
  },
}];
