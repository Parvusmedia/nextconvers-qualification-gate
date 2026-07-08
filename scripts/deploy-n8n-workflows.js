#!/usr/bin/env node
/**
 * Deploy local workflow JSON files to n8n Cloud via Public API.
 *
 * Matching: each entry in config/n8n-deploy.json is matched to a remote workflow
 * by `n8n_name` (or the `name` field inside the JSON file). Optional `workflow_id`
 * skips name lookup.
 *
 * Usage:
 *   node scripts/sync-workflow-code.js
 *   node scripts/apply-deployment-secrets.js
 *   node scripts/deploy-n8n-workflows.js
 *   node scripts/deploy-n8n-workflows.js --list          # show remote matches
 *   node scripts/deploy-n8n-workflows.js --only qualification-gate-mvp.json
 *
 * Secrets (gitignored): config/deployment.local.env
 *   N8N_BASE_URL=https://pmedia.app.n8n.cloud
 *   N8N_API_KEY=...
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const DEPLOY_CONFIG = path.join(ROOT, 'config/n8n-deploy.json');
const LOCAL_ENV = path.join(ROOT, 'config/deployment.local.env');

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

function request(baseUrl, apiKey, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const url = new URL(urlPath, baseUrl);
    const req = https.request(url, {
      method,
      headers: {
        'X-N8N-API-KEY': apiKey,
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
          reject(new Error(`${method} ${url.pathname} -> ${res.statusCode}: ${parsed.message || JSON.stringify(parsed)}`));
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

async function listAllWorkflows(baseUrl, apiKey) {
  const all = [];
  let cursor;

  do {
    const qs = new URLSearchParams({ limit: '100' });
    if (cursor) qs.set('cursor', cursor);
    const resp = await request(baseUrl, apiKey, 'GET', `/api/v1/workflows?${qs}`);
    all.push(...(resp.data || []));
    cursor = resp.nextCursor;
  } while (cursor);

  return all;
}

function buildPutPayload(localWorkflow) {
  const settings = { ...(localWorkflow.settings || {}) };
  delete settings.timeSavedMode;
  delete settings.callerPolicy;

  return {
    name: localWorkflow.name,
    nodes: localWorkflow.nodes,
    connections: localWorkflow.connections || {},
    settings,
  };
}

function findRemote(remoteList, entry, localWorkflow) {
  if (entry.workflow_id) {
    const byId = remoteList.find(w => w.id === entry.workflow_id);
    if (!byId) throw new Error(`workflow_id not found on n8n: ${entry.workflow_id}`);
    return byId;
  }

  const targetName = entry.n8n_name || localWorkflow.name;
  const matches = remoteList.filter(w => w.name === targetName);
  if (matches.length === 0) {
    throw new Error(`No remote workflow named "${targetName}". Use --list to see names, or set workflow_id in config/n8n-deploy.json`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple remote workflows named "${targetName}". Set workflow_id in config/n8n-deploy.json`);
  }
  return matches[0];
}

async function main() {
  const args = process.argv.slice(2);
  const listOnly = args.includes('--list');
  const onlyFilter = args.find(a => a.startsWith('--only='))?.slice(7)
    || (args.includes('--only') ? args[args.indexOf('--only') + 1] : null);

  const deployCfg = JSON.parse(fs.readFileSync(DEPLOY_CONFIG, 'utf8'));
  const env = loadEnv(LOCAL_ENV);
  const baseUrl = (env.N8N_BASE_URL || deployCfg.base_url || '').replace(/\/$/, '');
  const apiKey = env.N8N_API_KEY;

  if (!apiKey) {
    throw new Error('N8N_API_KEY missing. Add it to config/deployment.local.env');
  }
  if (!baseUrl) {
    throw new Error('N8N_BASE_URL missing in deployment.local.env or config/n8n-deploy.json');
  }

  console.log(`n8n deploy → ${baseUrl}\n`);

  const remoteList = await listAllWorkflows(baseUrl, apiKey);
  let entries = deployCfg.workflows || [];

  if (onlyFilter) {
    entries = entries.filter(e => e.file.includes(onlyFilter));
    if (!entries.length) throw new Error(`No deploy entry matches --only ${onlyFilter}`);
  }

  if (listOnly) {
    for (const entry of entries) {
      const localPath = path.join(ROOT, entry.file);
      const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
      const targetName = entry.n8n_name || local.name;
      const remote = remoteList.find(w => w.name === targetName);
      const idHint = entry.workflow_id ? ` (forced id ${entry.workflow_id})` : '';
      console.log(`${entry.file}`);
      console.log(`  n8n_name: ${targetName}${idHint}`);
      if (remote) {
        console.log(`  → ${remote.id}  ${remote.active ? '[ON]' : '[off]'}  (${remote.nodes?.length || '?'} nodes)`);
      } else {
        console.log('  → NOT FOUND on n8n');
      }
      console.log('');
    }
    return;
  }

  for (const entry of entries) {
    const localPath = path.join(ROOT, entry.file);
    const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    const remote = findRemote(remoteList, entry, local);
    const wasActive = remote.active === true;
    const payload = buildPutPayload(local);

    console.log(`Updating ${remote.id}  ${remote.name}`);
    console.log(`  file: ${entry.file}`);
    console.log(`  nodes: ${payload.nodes.length}, was ${remote.active ? 'active' : 'inactive'}`);

    await request(baseUrl, apiKey, 'PUT', `/api/v1/workflows/${remote.id}`, payload);

    if (wasActive) {
      await request(baseUrl, apiKey, 'POST', `/api/v1/workflows/${remote.id}/activate`);
      console.log('  re-activated');
    }

    console.log('  ✓ done\n');
  }

  console.log('Deploy complete.');
}

main().catch(err => {
  console.error('Deploy failed:', err.message);
  process.exit(1);
});
