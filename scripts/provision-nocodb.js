#!/usr/bin/env node
/**
 * Provision NocoDB tables + seed data for Qualification Gate.
 * Usage:
 *   NOCODB_BASE_ID=pgldlo34lezvu7e node scripts/provision-nocodb.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const BASE_URL = (process.env.NOCODB_BASE_URL || 'https://mpa.parvusmedia.com').replace(/\/$/, '');
const BASE_ID = process.env.NOCODB_BASE_ID || 'pgldlo34lezvu7e';
const PREFIX = process.env.NOCODB_TABLE_PREFIX !== undefined
  ? process.env.NOCODB_TABLE_PREFIX
  : (BASE_ID === 'phh986hkgi1daju' ? 'qg_' : '');
const BASE_TITLE = process.env.NOCODB_BASE_TITLE || (BASE_ID === 'pgldlo34lezvu7e'
  ? 'Telefónica Seguros Qualification Gate'
  : 'Automation Platform (shared base)');

function t(name) {
  return { title: `${PREFIX}${name}`, table_name: `${PREFIX}${name}` };
}

function loadToken() {
  const localEnv = path.join(ROOT, 'config/deployment.local.env');
  if (fs.existsSync(localEnv)) {
    for (const line of fs.readFileSync(localEnv, 'utf8').split('\n')) {
      if (line.startsWith('NOCODB_API_TOKEN=')) {
        return line.split('=').slice(1).join('=').trim();
      }
    }
  }
  if (process.env.NOCODB_API_TOKEN) return process.env.NOCODB_API_TOKEN.trim();
  const envPath = '/opt/apps/fly456bot/.env';
  if (fs.existsSync(envPath)) {
    const line = fs.readFileSync(envPath, 'utf8').split('\n').find(l => l.startsWith('NOCODB_API_TOKEN='));
    if (line) return line.split('=').slice(1).join('=').trim();
  }
  throw new Error('NOCODB_API_TOKEN not set');
}

function request(method, urlPath, body) {
  const token = loadToken();
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

const col = {
  text: (title, name = title.toLowerCase().replace(/\s+/g, '_')) => ({ title, column_name: name, uidt: 'SingleLineText' }),
  long: (title, name) => ({ title, column_name: name || title.toLowerCase().replace(/\s+/g, '_'), uidt: 'LongText' }),
  num: (title, name) => ({ title, column_name: name || title.toLowerCase().replace(/\s+/g, '_'), uidt: 'Number' }),
  bool: (title, name) => ({ title, column_name: name || title.toLowerCase().replace(/\s+/g, '_'), uidt: 'Checkbox' }),
  select: (title, name, choices) => ({
    title,
    column_name: name || title.toLowerCase().replace(/\s+/g, '_'),
    uidt: 'SingleSelect',
    colOptions: { options: choices.map(c => (typeof c === 'string' ? { title: c, color: '#6c757d' } : c)) },
  }),
};

function buildTables() {
  return [
    {
      ...t('clients'),
      columns: [col.text('account_id'), col.text('client_name'), col.bool('active')],
    },
    {
      ...t('campaign_policies'),
      columns: [
        col.text('account_id'), col.text('campaign_name'), col.text('product_name'),
        col.select('motion_type', 'motion_type', ['final_client', 'broker_channel', 'partner', 'other']),
        col.bool('active'), col.long('target_description'),
        col.long('allowed_countries'), col.long('excluded_countries'),
        col.long('allowed_industries'), col.long('excluded_industries'),
        col.long('target_roles'), col.long('review_roles'), col.long('excluded_roles'),
        col.long('target_departments'), col.long('excluded_departments'),
        col.long('target_company_types'), col.long('review_company_types'), col.long('excluded_company_types'),
        col.long('target_keywords'), col.long('review_keywords'), col.long('excluded_keywords'),
        col.num('min_company_size'), col.num('max_company_size'),
        col.num('min_profile_score'), col.num('min_company_score'),
        col.num('ready_for_crm_profile_score'), col.num('ready_for_crm_company_score'),
        col.bool('review_if_profile_score_high_company_score_low'),
        col.bool('require_no_suppression_match'), col.bool('require_no_crm_duplicate'),
        col.bool('require_no_existing_customer'), col.bool('require_no_competitor'),
        col.num('auto_ready_threshold'), col.num('review_threshold'), col.long('policy_notes'),
      ],
    },
    {
      ...t('suppression_entities'),
      columns: [
        col.text('account_id'), col.text('campaign_name'),
        col.select('entity_type', 'entity_type', ['company_name', 'company_domain', 'linkedin_company_url', 'person_linkedin_url', 'profile_id', 'headline_keyword', 'title_keyword', 'company_industry', 'company_type', 'email_domain']),
        col.text('entity_value'),
        col.select('match_type', 'match_type', ['exact', 'contains', 'domain', 'linkedin_url', 'normalized_name']),
        col.select('reason', 'reason', ['existing_customer', 'competitor', 'partner', 'provider', 'employee', 'not_icp', 'blocked_manually']),
        col.select('severity', 'severity', ['reject', 'review']), col.bool('active'),
      ],
    },
    {
      ...t('account_blocklist_snapshots'),
      columns: [
        col.text('account_id'),
        col.num('chunk_index'),
        col.long('customer_names_json'),
        col.long('customer_domains_json'),
        col.long('customer_linkedin_urls_json'),
        col.text('source'),
        col.num('name_count'),
        col.num('domain_count'),
        col.num('linkedin_count'),
        col.text('updated_at'),
      ],
    },
    {
      ...t('company_identities'),
      columns: [
        col.text('account_id'),
        col.text('canonical_id'),
        col.text('identity_type'),
        col.text('identity_value'),
        col.text('match_strength'),
        col.text('source'),
        col.bool('active'),
        col.long('notes'),
      ],
    },
    {
      ...t('lead_decisions'),
      columns: [
        col.text('account_id'), col.text('campaign_name'), col.text('product_name'), col.text('motion_type'),
        col.num('source_row_id'), col.text('profile_id'), col.text('public_identifier'),
        col.text('linkedin_url'), col.text('profile_url'), col.text('name'), col.text('first_name'), col.text('last_name'),
        col.long('headline'), col.text('country_code'), col.text('country'), col.text('state'), col.text('city'), col.text('location'),
        col.text('company_name'), col.long('company_linkedin_url'), col.text('company_industry'),
        col.text('current_position'), col.long('current_company_description'), col.long('summary'), col.long('quick_summary'),
        col.num('connections_count'), col.num('follower_count'), col.long('skills_text'), col.long('top_skills_text'),
        col.text('react_type'), col.num('reacts_count'), col.num('reacted_posts_count'), col.long('post_url'),
        col.num('profile_score'), col.long('profile_score_summary'), col.num('company_score'), col.long('company_score_summary'),
        col.num('current_company_employee_count'), col.text('current_company_headquarter_city'),
        col.text('current_company_headquarter_country'), col.text('current_company_headquarter_region'),
        col.text('email_enriched'),
        col.select('qualification_status', 'qualification_status', ['READY_FOR_CRM', 'READY_FOR_REVIEW', 'REJECTED', 'SUPPRESSED']),
        col.num('qualification_confidence'), col.long('decision_reason'), col.long('reject_reason'), col.long('review_reason'),
        col.long('suppression_matches'), col.long('risk_flags'), col.long('positive_signals'),
        col.select('crm_sync_status', 'crm_sync_status', ['pending', 'blocked', 'review', 'not_synced']),
        col.long('raw_payload'),
      ],
    },
    {
      ...t('feedback_events'),
      columns: [
        col.num('lead_decision_id'), col.text('account_id'), col.text('campaign_name'),
        col.select('user_action', 'user_action', ['approve_for_crm', 'reject', 'reject_existing_customer', 'reject_competitor', 'reject_wrong_icp', 'reject_broker', 'reject_final_client', 'block_company', 'block_person', 'mark_as_customer', 'mark_as_competitor']),
        col.text('feedback_reason'), col.long('notes'),
      ],
    },
    {
      ...t('learned_rules'),
      columns: [
        col.text('account_id'), col.text('campaign_name'), col.text('rule_type'), col.long('pattern'),
        col.select('decision', 'decision', ['READY_FOR_CRM', 'READY_FOR_REVIEW', 'REJECTED', 'SUPPRESSED']),
        col.num('confidence'), col.bool('active'), col.num('created_from_feedback_count'),
      ],
    },
    {
      ...t('conversation_control'),
      columns: [
        col.text('account_id'), col.long('linkedin_url'), col.text('conversation_owner'), col.bool('automation_lock'),
        col.text('last_outbound_tool'), col.long('last_inbound_message'), col.long('last_outbound_message'),
        col.text('reply_intent'), col.num('interest_score'), col.bool('handoff_required'), col.text('next_action'),
      ],
    },
  ];
}

const TABLE_KEYS = {
  clients: () => t('clients').title,
  campaign_policies: () => t('campaign_policies').title,
  suppression_entities: () => t('suppression_entities').title,
  account_blocklist_snapshots: () => t('account_blocklist_snapshots').title,
  company_identities: () => t('company_identities').title,
  lead_decisions: () => t('lead_decisions').title,
};

async function listTables() {
  const resp = await request('GET', `/api/v2/meta/bases/${BASE_ID}/tables`);
  return resp.list || [];
}

async function createTable(def) {
  return request('POST', `/api/v2/meta/bases/${BASE_ID}/tables`, def);
}

async function insertRecords(tableId, rows) {
  const results = [];
  for (const row of rows) {
    results.push(await request('POST', `/api/v2/tables/${tableId}/records`, row));
  }
  return results;
}

function policyToRow(policy) {
  const row = { ...policy };
  for (const k of Object.keys(row)) {
    if (Array.isArray(row[k])) row[k] = JSON.stringify(row[k]);
  }
  if (row.active === undefined) row.active = true;
  return row;
}

async function main() {
  const TABLES = buildTables();
  console.log(`Provisioning Qualification Gate on ${BASE_URL}`);
  console.log(`Base: ${BASE_ID} (${BASE_TITLE})`);
  console.log(`Table prefix: "${PREFIX}"\n`);

  const existing = await listTables();
  const byTitle = Object.fromEntries(existing.map(tbl => [tbl.title, tbl]));

  const tableIds = {};
  for (const def of TABLES) {
    if (byTitle[def.title]) {
      tableIds[def.title] = byTitle[def.title].id;
      console.log(`✓ exists: ${def.title} (${byTitle[def.title].id})`);
    } else {
      const created = await createTable(def);
      tableIds[def.title] = created.id;
      console.log(`+ created: ${def.title} (${created.id})`);
    }
  }

  const accountId = process.env.QG_ACCOUNT_ID || 'rq1lQcYTToC9hlWD4vO94g';
  const clientsTable = tableIds[TABLE_KEYS.clients()];
  const policiesTable = tableIds[TABLE_KEYS.campaign_policies()];
  const suppressionsTable = tableIds[TABLE_KEYS.suppression_entities()];

  const clients = await request('GET', `/api/v2/tables/${clientsTable}/records?where=(account_id,eq,${accountId})&limit=1`);
  if (!(clients.list || []).length) {
    await insertRecords(clientsTable, [{ account_id: accountId, client_name: 'Telefónica (example)', active: true }]);
    console.log('+ seeded: clients');
  }

  const policies = [
    policyToRow(JSON.parse(fs.readFileSync(path.join(ROOT, 'config/examples/telefonica-cyberseguro-final-client.json'), 'utf8'))),
    policyToRow(JSON.parse(fs.readFileSync(path.join(ROOT, 'config/examples/telefonica-cyberseguro-brokers.json'), 'utf8'))),
  ].map(p => ({ ...p, account_id: accountId }));

  for (const policy of policies) {
    const check = await request('GET', `/api/v2/tables/${policiesTable}/records?where=(account_id,eq,${accountId})~and(campaign_name,eq,${encodeURIComponent(policy.campaign_name)})&limit=1`);
    if (!(check.list || []).length) {
      await insertRecords(policiesTable, [policy]);
      console.log(`+ seeded policy: ${policy.campaign_name}`);
    }
  }

  const suppressions = [
    { account_id: accountId, campaign_name: '', entity_type: 'company_name', entity_value: 'Movistar', match_type: 'contains', reason: 'existing_customer', severity: 'reject', active: true },
    { account_id: accountId, campaign_name: '', entity_type: 'company_name', entity_value: 'Telefónica', match_type: 'contains', reason: 'existing_customer', severity: 'reject', active: true },
    { account_id: accountId, campaign_name: 'Cyberseguro - Cliente Final', entity_type: 'headline_keyword', entity_value: 'recruiter', match_type: 'contains', reason: 'not_icp', severity: 'reject', active: true },
  ];

  for (const s of suppressions) {
    const check = await request('GET', `/api/v2/tables/${suppressionsTable}/records?where=(account_id,eq,${accountId})~and(entity_value,eq,${encodeURIComponent(s.entity_value)})&limit=1`);
    if (!(check.list || []).length) {
      await insertRecords(suppressionsTable, [s]);
      console.log(`+ seeded suppression: ${s.entity_value}`);
    }
  }

  const deployment = {
    nocodb_base_url: BASE_URL,
    nocodb_base_id: BASE_ID,
    nocodb_legacy_table_id: 'm3ujhhptvtap9ww',
    nocodb_legacy_view_id: 'vwsxislthqpv89xq',
    nocodb_legacy_table_note: 'Empty placeholder table created manually; safe to delete from UI',
    nocodb_clients_table_id: tableIds[TABLE_KEYS.clients()],
    nocodb_campaign_policies_table_id: tableIds[TABLE_KEYS.campaign_policies()],
    nocodb_suppression_entities_table_id: tableIds[TABLE_KEYS.suppression_entities()],
    nocodb_blocklist_snapshots_table_id: tableIds[TABLE_KEYS.account_blocklist_snapshots()],
    nocodb_company_identities_table_id: tableIds[TABLE_KEYS.company_identities()],
    nocodb_lead_decisions_table_id: tableIds[TABLE_KEYS.lead_decisions()],
    nocodb_feedback_events_table_id: tableIds[t('feedback_events').title],
    nocodb_learned_rules_table_id: tableIds[t('learned_rules').title],
    nocodb_conversation_control_table_id: tableIds[t('conversation_control').title],
    qg_account_id: accountId,
    generated_at: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(ROOT, 'config/deployment.generated.json'), JSON.stringify(deployment, null, 2));
  console.log('\nWrote config/deployment.generated.json');
  console.log(JSON.stringify({
    nocodb_base_id: deployment.nocodb_base_id,
    nocodb_campaign_policies_table_id: deployment.nocodb_campaign_policies_table_id,
    nocodb_suppression_entities_table_id: deployment.nocodb_suppression_entities_table_id,
    nocodb_blocklist_snapshots_table_id: deployment.nocodb_blocklist_snapshots_table_id,
    nocodb_lead_decisions_table_id: deployment.nocodb_lead_decisions_table_id,
    nocodb_clients_table_id: deployment.nocodb_clients_table_id,
  }, null, 2));
}

main().catch(err => {
  console.error('Provision failed:', err.message);
  process.exit(1);
});
