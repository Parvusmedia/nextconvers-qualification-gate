#!/usr/bin/env node
/**
 * Apply secrets from config/deployment.local.env into n8n workflow config1.
 * Does not commit secrets — deployment.local.env is gitignored.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const envPath = path.join(ROOT, 'config/deployment.local.env');
const depPath = path.join(ROOT, 'config/deployment.generated.json');
const wfPath = path.join(ROOT, 'n8n/workflows/qualification-gate-mvp.json');

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const local = loadEnv(envPath);
const dep = fs.existsSync(depPath) ? JSON.parse(fs.readFileSync(depPath, 'utf8')) : {};
const merged = { ...dep, ...local };

const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
const config = wf.nodes.find(n => n.name === 'config1');
if (!config) throw new Error('config1 node not found');

const values = {
  nocodb_base_url: merged.NOCODB_BASE_URL || merged.nocodb_base_url,
  nocodb_api_token: merged.NOCODB_API_TOKEN || merged.nocodb_api_token,
  nocodb_base_id: merged.NOCODB_BASE_ID || merged.nocodb_base_id,
  nocodb_clients_table_id: merged.nocodb_clients_table_id,
  nocodb_campaign_policies_table_id: merged.nocodb_campaign_policies_table_id,
  nocodb_suppression_entities_table_id: merged.nocodb_suppression_entities_table_id,
  nocodb_lead_decisions_table_id: merged.nocodb_lead_decisions_table_id,
};

for (const a of config.parameters.assignments.assignments) {
  if (values[a.name]) a.value = values[a.name];
}

let hasBaseId = config.parameters.assignments.assignments.some(a => a.name === 'nocodb_base_id');
if (!hasBaseId && values.nocodb_base_id) {
  config.parameters.assignments.assignments.push({
    id: 'cfg-base-id', name: 'nocodb_base_id', value: values.nocodb_base_id, type: 'string',
  });
}

fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2));
console.log('Applied secrets to n8n/workflows/qualification-gate-mvp.json config1');
console.log('  nocodb_base_url:', values.nocodb_base_url);
console.log('  nocodb_base_id:', values.nocodb_base_id);
console.log('  nocodb_api_token: [set]');
console.log('  lead_decisions table:', values.nocodb_lead_decisions_table_id);
