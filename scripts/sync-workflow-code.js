#!/usr/bin/env node
/**
 * Embed n8n/code-nodes/*.js into workflow JSON code nodes.
 * Usage: node scripts/sync-workflow-code.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CODE_DIR = path.join(ROOT, 'n8n/code-nodes');

const WORKFLOW_MAPPINGS = [
  {
    workflow: path.join(ROOT, 'n8n/workflows/qualification-gate-mvp.json'),
    nodes: {
      'Merge Context': 'merge-context.js',
      'Evaluate Hard Rules': 'evaluate-hard-rules.js',
    },
  },
  {
    workflow: path.join(ROOT, 'n8n/workflows/pipedrive-suppression-sync.json'),
    nodes: {
      'Fetch Pipedrive Customers': 'pipedrive-fetch-customers.js',
      'Sync Suppressions to NocoDB': 'pipedrive-sync-suppressions.js',
      'Write Blocklist Snapshot': 'write-blocklist-snapshot.js',
    },
  },
];

for (const { workflow, nodes } of WORKFLOW_MAPPINGS) {
  if (!fs.existsSync(workflow)) {
    console.warn('Skip missing workflow:', workflow);
    continue;
  }

  const wf = JSON.parse(fs.readFileSync(workflow, 'utf8'));
  let updated = 0;

  for (const [nodeName, fileName] of Object.entries(nodes)) {
    const codePath = path.join(CODE_DIR, fileName);
    if (!fs.existsSync(codePath)) {
      console.warn(`  Code file missing: ${fileName}`);
      continue;
    }

    const node = wf.nodes.find(n => n.name === nodeName);
    if (!node) {
      console.warn(`  Node not found in ${path.basename(workflow)}: ${nodeName}`);
      continue;
    }

    const code = fs.readFileSync(codePath, 'utf8');
    node.parameters.jsCode = code;
    updated += 1;
    console.log(`  ${path.basename(workflow)} ← ${fileName} → ${nodeName}`);
  }

  if (updated > 0) {
    fs.writeFileSync(workflow, JSON.stringify(wf, null, 2));
    console.log(`Updated ${updated} node(s) in ${path.basename(workflow)}\n`);
  }
}
