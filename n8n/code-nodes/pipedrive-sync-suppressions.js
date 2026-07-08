// ======================================================
// n8n Code Node - Sync Pipedrive batch to suppression_entities
// Mode: Run Once for All Items
// Uses bulk NocoDB inserts + time budget for n8n Cloud 60s Code limit.
// Pending rows are stored in workflow static data between loop iterations.
// ======================================================

const SYNC_MATCH_TYPES = new Set(['normalized_name', 'domain', 'linkedin_url', 'exact']);

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

function rowKey(row) {
  const type = String(row.entity_type || '');
  const match = String(row.match_type || '');
  const value = String(row.entity_value || '').trim().toLowerCase();
  return `${type}|${match}|${value}`;
}

function isSyncManagedRow(row) {
  if (row.reason !== 'existing_customer') return false;
  if (row.campaign_name && row.campaign_name !== '') return false;
  if (!SYNC_MATCH_TYPES.has(row.match_type)) return false;
  if (row.match_type === 'exact' && row.entity_type !== 'company_document') return false;
  if (row.match_type === 'linkedin_url' && row.entity_type !== 'linkedin_company_url') return false;
  return true;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function hasTimeLeft(startedAt, budgetMs) {
  return Date.now() - startedAt < budgetMs;
}

function mergeRows(pendingRows, batchRows) {
  const rowMap = new Map();
  for (const row of pendingRows) rowMap.set(rowKey(row), row);
  for (const row of batchRows) rowMap.set(rowKey(row), row);
  return [...rowMap.values()];
}

async function loadExistingKeys(context, cfg, startedAt, budgetMs) {
  const baseUrl = String(cfg.nocodb_base_url || '').replace(/\/$/, '');
  const tableId = cfg.nocodb_suppression_entities_table_id;
  const token = cfg.nocodb_api_token;
  const headers = { 'xc-token': token };
  const pageSize = toPositiveInt(cfg.nocodb_page_size, 500);
  const maxPages = toPositiveInt(cfg.sync_existing_load_max_pages, 3);
  const where = `(account_id,eq,${cfg.qg_account_id})~and(reason,eq,existing_customer)`;

  const keys = new Set();
  let offset = 0;

  for (let page = 0; page < maxPages; page += 1) {
    if (!hasTimeLeft(startedAt, budgetMs)) break;

    const res = await context.helpers.httpRequest({
      method: 'GET',
      url: `${baseUrl}/api/v2/tables/${tableId}/records`,
      qs: { where, limit: pageSize, offset },
      headers,
      json: true,
    });

    const batch = getRecords(res).filter(isSyncManagedRow);
    for (const row of batch) keys.add(rowKey(row));
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return keys;
}

// --- MAIN (n8n) ---
const cfg = $('config1').first().json;
const fetchData = $('Fetch Pipedrive Customers').first().json;
const startedAt = Date.now();
const timeBudgetMs = toPositiveInt(cfg.code_time_budget_ms, 45000);
const bulkInsertSize = toPositiveInt(cfg.nocodb_bulk_insert_size, 100);
const maxBulkOps = toPositiveInt(cfg.sync_max_bulk_ops_per_run, 25);
const enableDeactivate = String(cfg.sync_enable_deactivate || 'false') === 'true';

const baseUrl = String(cfg.nocodb_base_url || '').replace(/\/$/, '');
const tableId = cfg.nocodb_suppression_entities_table_id;
const token = cfg.nocodb_api_token;
const headers = { 'xc-token': token, 'Content-Type': 'application/json' };

if (!tableId || !token) {
  throw new Error('NocoDB config missing in config1');
}

const staticData = $getWorkflowStaticData('global');
if (!staticData.existingKeys) staticData.existingKeys = [];
if (!staticData.pendingRows) staticData.pendingRows = [];

const pendingFromPrior = staticData.pendingRows.map(row => ({ ...row }));
const batchRows = (fetchData.desired_rows || []).map(row => ({ ...row }));
const combinedRows = mergeRows(pendingFromPrior, batchRows);

const existingKeySet = new Set(staticData.existingKeys);
if (existingKeySet.size < 1000) {
  const loadedKeys = await loadExistingKeys(this, cfg, startedAt, timeBudgetMs);
  for (const key of loadedKeys) existingKeySet.add(key);
  staticData.existingKeys = [...existingKeySet];
}

const toCreate = [];
let unchanged = 0;

for (const row of combinedRows) {
  const key = rowKey(row);
  if (existingKeySet.has(key)) {
    unchanged += 1;
  } else {
    toCreate.push(row);
  }
}

let created = 0;
let bulkOps = 0;
let bulkLimitReached = false;
let processedCount = 0;
const errors = [];

for (const chunk of chunkArray(toCreate, bulkInsertSize)) {
  if (!hasTimeLeft(startedAt, timeBudgetMs)) {
    bulkLimitReached = true;
    break;
  }
  if (bulkOps >= maxBulkOps) {
    bulkLimitReached = true;
    break;
  }

  try {
    await this.helpers.httpRequest({
      method: 'POST',
      url: `${baseUrl}/api/v2/tables/${tableId}/records`,
      headers,
      body: chunk,
      json: true,
    });
    for (const row of chunk) existingKeySet.add(rowKey(row));
    created += chunk.length;
    processedCount += chunk.length;
    bulkOps += 1;
  } catch (error) {
    errors.push({ action: 'bulk_create', size: chunk.length, message: error.message });
    bulkLimitReached = true;
    break;
  }
}

staticData.pendingRows = toCreate.slice(processedCount);
staticData.existingKeys = [...existingKeySet];

let deactivated = 0;
if (enableDeactivate && fetchData.fetch_complete && staticData.pendingRows.length === 0) {
  // Optional deactivate pass only after all pending rows are written.
}

if (fetchData.fetch_complete && staticData.pendingRows.length === 0) {
  staticData.existingKeys = [];
  staticData.pendingRows = [];
}

return [{
  json: {
    created,
    unchanged,
    deactivated,
    batch_desired_count: batchRows.length,
    pending_from_prior_count: pendingFromPrior.length,
    combined_row_count: combinedRows.length,
    to_create_count: toCreate.length,
    pending_remaining_count: staticData.pendingRows.length,
    bulk_ops_performed: bulkOps,
    bulk_limit_reached: bulkLimitReached,
    fetch_complete: fetchData.fetch_complete === true,
    sync_complete: fetchData.fetch_complete === true && staticData.pendingRows.length === 0,
    existing_keys_cached: existingKeySet.size,
    pipedrive_iteration: fetchData.pipedrive_iteration,
    timed_out: !hasTimeLeft(startedAt, timeBudgetMs),
    errors,
    completed_at: new Date().toISOString(),
  },
}];
