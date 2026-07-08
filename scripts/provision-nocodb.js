#!/usr/bin/env node
/**
 * Provision NocoDB tables + seed data for Qualification Gate.
 * Usage:
 *   NOCODB_API_TOKEN=xxx node scripts/provision-nocodb.js
 * Or reads from /opt/apps/fly456bot/.env if token not set.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const BASE_URL = (process.env.NOCODB_BASE_URL || 'https://mpa.parvusmedia.com').replace(/\/$/, '');
const BASE_ID = process.env.NOCODB_BASE_ID || 'phh986hkgi1daju';
const BASE_TITLE = 'Automation Platform (shared base)';

function loadToken() {
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

const TABLES = [
  {
    title: 'qg_clients',
    table_name: 'qg_clients',
    columns: [
      col.text('account_id'),
      col.text('client_name'),
      col.bool('active'),
    ],
  },
  {
    title: 'qg_campaign_policies',
    table_name: 'qg_campaign_policies',
    columns: [
      col.text('account_id'),
      col.text('campaign_name'),
      col.text('product_name'),
      col.select('motion_type', 'motion_type', ['final_client', 'broker_channel', 'partner', 'other']),
      col.bool('active'),
      col.long('target_description'),
      col.long('allowed_countries'),
      col.long('excluded_countries'),
      col.long('allowed_industries'),
      col.long('excluded_industries'),
      col.long('target_roles'),
      col.long('review_roles'),
      col.long('excluded_roles'),
      col.long('target_departments'),
      col.long('excluded_departments'),
      col.long('target_company_types'),
      col.long('review_company_types'),
      col.long('excluded_company_types'),
      col.long('target_keywords'),
      col.long('review_keywords'),
      col.long('excluded_keywords'),
      col.num('min_company_size'),
      col.num('max_company_size'),
      col.num('min_profile_score'),
      col.num('min_company_score'),
      col.num('ready_for_crm_profile_score'),
      col.num('ready_for_crm_company_score'),
      col.bool('review_if_profile_score_high_company_score_low'),
      col.bool('require_no_suppression_match'),
      col.bool('require_no_crm_duplicate'),
      col.bool('require_no_existing_customer'),
      col.bool('require_no_competitor'),
      col.num('auto_ready_threshold'),
      col.num('review_threshold'),
      col.long('policy_notes'),
    ],
  },
  {
    title: 'qg_suppression_entities',
    table_name: 'qg_suppression_entities',
    columns: [
      col.text('account_id'),
      col.text('campaign_name'),
      col.select('entity_type', 'entity_type', ['company_name', 'company_domain', 'linkedin_company_url', 'person_linkedin_url', 'profile_id', 'headline_keyword', 'title_keyword', 'company_industry', 'company_type', 'email_domain']),
      col.text('entity_value'),
      col.select('match_type', 'match_type', ['exact', 'contains', 'domain', 'linkedin_url', 'normalized_name']),
      col.select('reason', 'reason', ['existing_customer', 'competitor', 'partner', 'provider', 'employee', 'not_icp', 'blocked_manually']),
      col.select('severity', 'severity', ['reject', 'review']),
      col.bool('active'),
    ],
  },
  {
    title: 'qg_lead_decisions',
    table_name: 'qg_lead_decisions',
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
    title: 'qg_feedback_events',
    table_name: 'qg_feedback_events',
    columns: [
      col.num('lead_decision_id'), col.text('account_id'), col.text('campaign_name'),
      col.select('user_action', 'user_action', ['approve_for_crm', 'reject', 'reject_existing_customer', 'reject_competitor', 'reject_wrong_icp', 'reject_broker', 'reject_final_client', 'block_company', 'block_person', 'mark_as_customer', 'mark_as_competitor']),
      col.text('feedback_reason'), col.long('notes'),
    ],
  },
  {
    title: 'qg_learned_rules',
    table_name: 'qg_learned_rules',
    columns: [
      col.text('account_id'), col.text('campaign_name'), col.text('rule_type'), col.long('pattern'),
      col.select('decision', 'decision', ['READY_FOR_CRM', 'READY_FOR_REVIEW', 'REJECTED', 'SUPPRESSED']),
      col.num('confidence'), col.bool('active'), col.num('created_from_feedback_count'),
    ],
  },
  {
    title: 'qg_conversation_control',
    table_name: 'qg_conversation_control',
    columns: [
      col.text('account_id'), col.long('linkedin_url'), col.text('conversation_owner'), col.bool('automation_lock'),
      col.text('last_outbound_tool'), col.long('last_inbound_message'), col.long('last_outbound_message'),
      col.text('reply_intent'), col.num('interest_score'), col.bool('handoff_required'), col.text('next_action'),
    ],
  },
];

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
    const resp = await request('POST', `/api/v2/tables/${tableId}/records`, row);
    results.push(resp);
  }
  return results;
}

function jsonArrayField(obj, key) {
  const val = obj[key];
  return Array.isArray(val) ? JSON.stringify(val) : val;
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
  console.log(`Provisioning Qualification Gate on ${BASE_URL}`);
  console.log(`Base: ${BASE_ID} (${BASE_TITLE})\n`);

  const existing = await listTables();
  const byTitle = Object.fromEntries(existing.map(t => [t.title, t]));

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

  const clients = await request('GET', `/api/v2/tables/${tableIds.qg_clients}/records?where=(account_id,eq,${accountId})&limit=1`);
  if (!(clients.list || []).length) {
    await insertRecords(tableIds.qg_clients, [{ account_id: accountId, client_name: 'Telefónica (example)', active: true }]);
    console.log('+ seeded: qg_clients');
  } else {
    console.log('✓ qg_clients already has account row');
  }

  const policies = [
    policyToRow(JSON.parse(fs.readFileSync(path.join(ROOT, 'config/examples/telefonica-cyberseguro-final-client.json'), 'utf8'))),
    policyToRow(JSON.parse(fs.readFileSync(path.join(ROOT, 'config/examples/telefonica-cyberseguro-brokers.json'), 'utf8'))),
  ].map(p => ({ ...p, account_id: accountId }));

  for (const policy of policies) {
    const check = await request('GET', `/api/v2/tables/${tableIds.qg_campaign_policies}/records?where=(account_id,eq,${accountId})~and(campaign_name,eq,${encodeURIComponent(policy.campaign_name)})&limit=1`);
    if (!(check.list || []).length) {
      await insertRecords(tableIds.qg_campaign_policies, [policy]);
      console.log(`+ seeded policy: ${policy.campaign_name}`);
    } else {
      console.log(`✓ policy exists: ${policy.campaign_name}`);
    }
  }

  const suppressions = [
    { account_id: accountId, campaign_name: '', entity_type: 'company_name', entity_value: 'Movistar', match_type: 'contains', reason: 'existing_customer', severity: 'reject', active: true },
    { account_id: accountId, campaign_name: '', entity_type: 'company_name', entity_value: 'Telefónica', match_type: 'contains', reason: 'existing_customer', severity: 'reject', active: true },
    { account_id: accountId, campaign_name: 'Cyberseguro - Cliente Final', entity_type: 'headline_keyword', entity_value: 'recruiter', match_type: 'contains', reason: 'not_icp', severity: 'reject', active: true },
  ];

  for (const s of suppressions) {
    const check = await request('GET', `/api/v2/tables/${tableIds.qg_suppression_entities}/records?where=(account_id,eq,${accountId})~and(entity_value,eq,${encodeURIComponent(s.entity_value)})&limit=1`);
    if (!(check.list || []).length) {
      await insertRecords(tableIds.qg_suppression_entities, [s]);
      console.log(`+ seeded suppression: ${s.entity_value}`);
    } else {
      console.log(`✓ suppression exists: ${s.entity_value}`);
    }
  }

  const deployment = {
    nocodb_base_url: BASE_URL,
    nocodb_base_id: BASE_ID,
    nocodb_base_note: 'Tables provisioned in automation base (token cannot create new base). Prefix qg_ for isolation.',
    nocodb_clients_table_id: tableIds.qg_clients,
    nocodb_campaign_policies_table_id: tableIds.qg_campaign_policies,
    nocodb_suppression_entities_table_id: tableIds.qg_suppression_entities,
    nocodb_lead_decisions_table_id: tableIds.qg_lead_decisions,
    qg_account_id: accountId,
    generated_at: new Date().toISOString(),
  };

  const outPath = path.join(ROOT, 'config/deployment.generated.json');
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log('\nconfig1 values for n8n:');
  console.log(JSON.stringify({
    nocodb_base_url: deployment.nocodb_base_url,
    nocodb_campaign_policies_table_id: deployment.nocodb_campaign_policies_table_id,
    nocodb_suppression_entities_table_id: deployment.nocodb_suppression_entities_table_id,
    nocodb_lead_decisions_table_id: deployment.nocodb_lead_decisions_table_id,
    nocodb_clients_table_id: deployment.nocodb_clients_table_id,
  }, null, 2));
}

main().catch(err => {
  console.error('Provision failed:', err.message);
  process.exit(1);
});
