#!/usr/bin/env node
/**
 * Create account_blocklist_snapshots table (if missing) and rebuild snapshot
 * from all active existing_customer rows in suppression_entities.
 *
 * Usage:
 *   node scripts/rebuild-blocklist-snapshot.js
 *   QG_ACCOUNT_ID=rq1lQcYTToC9hlWD4vO94g node scripts/rebuild-blocklist-snapshot.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const { buildBlocklistSnapshotFromRows, buildSnapshotChunkRows } = require('../n8n/code-nodes/lib/blocklist-snapshot');

const BASE_URL = (process.env.NOCODB_BASE_URL || 'https://mpa.parvusmedia.com').replace(/\/$/, '');
const BASE_ID = process.env.NOCODB_BASE_ID || 'pgldlo34lezvu7e';
const ACCOUNT_ID = process.env.QG_ACCOUNT_ID || 'rq1lQcYTToC9hlWD4vO94g';
const PAGE_SIZE = Number(process.env.NOCODB_PAGE_SIZE) || 500;

function loadConfig() {
  const depPath = path.join(ROOT, 'config/deployment.generated.json');
  const dep = fs.existsSync(depPath) ? JSON.parse(fs.readFileSync(depPath, 'utf8')) : {};

  const localEnv = path.join(ROOT, 'config/deployment.local.env');
  let token = process.env.NOCODB_API_TOKEN;
  if (!token && fs.existsSync(localEnv)) {
    for (const line of fs.readFileSync(localEnv, 'utf8').split('\n')) {
      if (line.startsWith('NOCODB_API_TOKEN=')) {
        token = line.split('=').slice(1).join('=').trim();
      }
    }
  }

  return {
    token,
    suppressionTableId: process.env.NOCODB_SUPPRESSION_ENTITIES_TABLE_ID || dep.nocodb_suppression_entities_table_id,
    snapshotTableId: process.env.NOCODB_BLOCKLIST_SNAPSHOTS_TABLE_ID || dep.nocodb_blocklist_snapshots_table_id,
    identitiesTableId: process.env.NOCODB_COMPANY_IDENTITIES_TABLE_ID || dep.nocodb_company_identities_table_id,
  };
}

function request(token, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const url = new URL(urlPath, BASE_URL);
    const req = https.request(url, {
      method,
      headers: {
        'xc-token': token,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw }; }
        if (res.statusCode >= 400) {
          reject(new Error(`${method} ${urlPath} -> ${res.statusCode}: ${parsed.message || parsed.error || raw}`));
        } else {
          resolve(parsed);
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function getRecords(resp) {
  if (!resp) return [];
  if (Array.isArray(resp.list)) return resp.list;
  if (Array.isArray(resp.records)) return resp.records;
  return [];
}

async function ensureSnapshotTable(token) {
  const tables = await request(token, 'GET', `/api/v2/meta/bases/${BASE_ID}/tables`);
  const existing = (tables.list || []).find(t => t.title === 'account_blocklist_snapshots');
  if (existing) {
    const cols = existing.columns || [];
    if (!cols.some(c => c.column_name === 'chunk_index')) {
      await request(token, 'POST', `/api/v2/meta/tables/${existing.id}/columns`, {
        title: 'chunk_index',
        column_name: 'chunk_index',
        uidt: 'Number',
      });
      console.log('+ added column chunk_index to account_blocklist_snapshots');
    }
    if (!cols.some(c => c.column_name === 'customer_linkedin_urls_json')) {
      await request(token, 'POST', `/api/v2/meta/tables/${existing.id}/columns`, {
        title: 'customer_linkedin_urls_json',
        column_name: 'customer_linkedin_urls_json',
        uidt: 'LongText',
      });
      console.log('+ added column customer_linkedin_urls_json to account_blocklist_snapshots');
    }
    if (!cols.some(c => c.column_name === 'linkedin_count')) {
      await request(token, 'POST', `/api/v2/meta/tables/${existing.id}/columns`, {
        title: 'linkedin_count',
        column_name: 'linkedin_count',
        uidt: 'Number',
      });
      console.log('+ added column linkedin_count to account_blocklist_snapshots');
    }
    return existing.id;
  }

  const created = await request(token, 'POST', `/api/v2/meta/bases/${BASE_ID}/tables`, {
    title: 'account_blocklist_snapshots',
    table_name: 'account_blocklist_snapshots',
    columns: [
      { title: 'account_id', column_name: 'account_id', uidt: 'SingleLineText' },
      { title: 'chunk_index', column_name: 'chunk_index', uidt: 'Number' },
      { title: 'customer_names_json', column_name: 'customer_names_json', uidt: 'LongText' },
      { title: 'customer_domains_json', column_name: 'customer_domains_json', uidt: 'LongText' },
      { title: 'customer_linkedin_urls_json', column_name: 'customer_linkedin_urls_json', uidt: 'LongText' },
      { title: 'source', column_name: 'source', uidt: 'SingleLineText' },
      { title: 'name_count', column_name: 'name_count', uidt: 'Number' },
      { title: 'domain_count', column_name: 'domain_count', uidt: 'Number' },
      { title: 'linkedin_count', column_name: 'linkedin_count', uidt: 'Number' },
      { title: 'updated_at', column_name: 'updated_at', uidt: 'SingleLineText' },
    ],
  });

  console.log(`+ created table account_blocklist_snapshots (${created.id})`);
  return created.id;
}

async function ensureCompanyIdentitiesTable(token) {
  const tables = await request(token, 'GET', `/api/v2/meta/bases/${BASE_ID}/tables`);
  const existing = (tables.list || []).find(t => t.title === 'company_identities');
  if (existing) return existing.id;

  const created = await request(token, 'POST', `/api/v2/meta/bases/${BASE_ID}/tables`, {
    title: 'company_identities',
    table_name: 'company_identities',
    columns: [
      { title: 'account_id', column_name: 'account_id', uidt: 'SingleLineText' },
      { title: 'canonical_id', column_name: 'canonical_id', uidt: 'SingleLineText' },
      { title: 'identity_type', column_name: 'identity_type', uidt: 'SingleLineText' },
      { title: 'identity_value', column_name: 'identity_value', uidt: 'SingleLineText' },
      { title: 'match_strength', column_name: 'match_strength', uidt: 'SingleLineText' },
      { title: 'source', column_name: 'source', uidt: 'SingleLineText' },
      { title: 'active', column_name: 'active', uidt: 'Checkbox' },
      { title: 'notes', column_name: 'notes', uidt: 'LongText' },
    ],
  });
  console.log(`+ created table company_identities (${created.id})`);
  return created.id;
}

async function loadIdentities(token, tableId) {
  if (!tableId) return [];
  const where = `(account_id,eq,${ACCOUNT_ID})~and(active,eq,true)`;
  const resp = await request(token, 'GET', `/api/v2/tables/${tableId}/records?where=${encodeURIComponent(where)}&limit=500`);
  return getRecords(resp);
}

async function loadAllSuppressions(token, tableId) {
  const where = `(account_id,eq,${ACCOUNT_ID})~and(reason,eq,existing_customer)~and(active,eq,true)`;
  const all = [];
  let offset = 0;

  while (true) {
    const resp = await request(
      token,
      'GET',
      `/api/v2/tables/${tableId}/records?where=${encodeURIComponent(where)}&limit=${PAGE_SIZE}&offset=${offset}`
    );
    const batch = getRecords(resp);
    all.push(...batch);
    process.stdout.write(`\r  loaded ${all.length} suppression rows...`);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  process.stdout.write('\n');
  return all;
}

async function deleteExistingChunks(token, tableId) {
  const existingResp = await request(
    token,
    'GET',
    `/api/v2/tables/${tableId}/records?where=(account_id,eq,${ACCOUNT_ID})&limit=100`
  );
  const existing = getRecords(existingResp);
  if (!existing.length) return 0;

  await request(token, 'DELETE', `/api/v2/tables/${tableId}/records`, existing.map(row => ({ Id: row.Id || row.id })));
  return existing.length;
}

async function insertChunkRows(token, tableId, rows) {
  for (const row of rows) {
    await request(token, 'POST', `/api/v2/tables/${tableId}/records`, row);
  }
}

async function upsertSnapshot(token, tableId, snapshot) {
  const chunkRows = buildSnapshotChunkRows(snapshot, snapshot.source);
  const deleted = await deleteExistingChunks(token, tableId);
  await insertChunkRows(token, tableId, chunkRows);
  return { deleted, inserted: chunkRows.length };
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.token) throw new Error('NOCODB_API_TOKEN not set');
  if (!cfg.suppressionTableId) throw new Error('suppression_entities table ID not found');

  console.log(`Rebuilding blocklist snapshot for account ${ACCOUNT_ID}`);
  console.log(`Base: ${BASE_URL} (${BASE_ID})\n`);

  const snapshotTableId = cfg.snapshotTableId || await ensureSnapshotTable(cfg.token);
  const identitiesTableId = cfg.identitiesTableId || await ensureCompanyIdentitiesTable(cfg.token);

  console.log('Loading suppression_entities...');
  const rows = await loadAllSuppressions(cfg.token, cfg.suppressionTableId);
  const identities = await loadIdentities(cfg.token, identitiesTableId);

  const snapshot = buildBlocklistSnapshotFromRows(rows, identities);
  snapshot.account_id = ACCOUNT_ID;
  snapshot.source = 'manual_rebuild';
  snapshot.updated_at = new Date().toISOString();

  console.log(`Building snapshot: ${snapshot.name_count} names, ${snapshot.domain_count} domains, ${snapshot.linkedin_count} linkedin URLs`);
  const result = await upsertSnapshot(cfg.token, snapshotTableId, snapshot);

  const depPath = path.join(ROOT, 'config/deployment.generated.json');
  const dep = fs.existsSync(depPath) ? JSON.parse(fs.readFileSync(depPath, 'utf8')) : {};
  dep.nocodb_blocklist_snapshots_table_id = snapshotTableId;
  dep.nocodb_company_identities_table_id = identitiesTableId;
  dep.generated_at = new Date().toISOString();
  fs.writeFileSync(depPath, JSON.stringify(dep, null, 2));

  console.log('\nSnapshot saved.');
  console.log(`  table_id: ${snapshotTableId}`);
  console.log(`  name_count: ${snapshot.name_count}`);
  console.log(`  domain_count: ${snapshot.domain_count}`);
  console.log(`  linkedin_count: ${snapshot.linkedin_count}`);
  console.log(`  identity_rows_merged: ${identities.length}`);
  console.log(`  chunks_deleted: ${result.deleted}`);
  console.log(`  chunks_inserted: ${result.inserted}`);
  console.log('\nUpdated config/deployment.generated.json');
}

main().catch(err => {
  console.error('Rebuild failed:', err.message);
  process.exit(1);
});
