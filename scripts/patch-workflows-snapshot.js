#!/usr/bin/env node
/**
 * Patch n8n workflows for blocklist snapshot architecture.
 * Run once after adding snapshot code nodes. Then: node scripts/sync-workflow-code.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SNAPSHOT_TABLE_PLACEHOLDER = 'REPLACE_WITH_BLOCKLIST_SNAPSHOTS_TABLE_ID';

function patchQualificationGate() {
  const wfPath = path.join(ROOT, 'n8n/workflows/qualification-gate-mvp.json');
  const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));

  const config = wf.nodes.find(n => n.name === 'config1');
  const hasSnapshotCfg = config.parameters.assignments.assignments.some(
    a => a.name === 'nocodb_blocklist_snapshots_table_id'
  );
  if (!hasSnapshotCfg) {
    config.parameters.assignments.assignments.push({
      id: 'cfg-blocklist-snapshot',
      name: 'nocodb_blocklist_snapshots_table_id',
      value: SNAPSHOT_TABLE_PLACEHOLDER,
      type: 'string',
    });
  }

  const sticky = wf.nodes.find(n => n.type === 'n8n-nodes-base.stickyNote');
  if (sticky) {
    sticky.parameters.content = sticky.parameters.content.replace(
      'Table IDs for campaign_policies, suppression_entities, lead_decisions',
      'Table IDs for campaign_policies, suppression_entities, account_blocklist_snapshots, lead_decisions'
    );
  }

  const loadSuppressions = wf.nodes.find(n => n.name === 'Load Suppressions');
  if (loadSuppressions) {
    loadSuppressions.name = 'Load Manual Suppressions';
    loadSuppressions.id = 'load-manual-suppressions-001';
    const limitParam = loadSuppressions.parameters.queryParameters.parameters.find(p => p.name === 'limit');
    if (limitParam) limitParam.value = '200';
  }

  let snapshotNode = wf.nodes.find(n => n.name === 'Load Blocklist Snapshot');
  if (!snapshotNode) {
    snapshotNode = {
      parameters: {
        url: "={{ $('config1').first().json.nocodb_base_url.replace(/\\/$/, '') }}/api/v2/tables/{{ $('config1').first().json.nocodb_blocklist_snapshots_table_id }}/records",
        sendQuery: true,
        queryParameters: {
          parameters: [
            {
              name: 'where',
              value: '=(account_id,eq,{{ $(\'Normalize Lead\').first().json.account_id }})',
            },
            { name: 'limit', value: '20' },
          ],
        },
        sendHeaders: true,
        headerParameters: {
          parameters: [
            {
              name: 'xc-token',
              value: "={{ $('config1').first().json.nocodb_api_token }}",
            },
          ],
        },
        options: {
          response: { response: { neverError: true } },
        },
      },
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [-120, 300],
      id: 'load-blocklist-snapshot-001',
      name: 'Load Blocklist Snapshot',
    };
    wf.nodes.push(snapshotNode);
  }

  wf.connections['Load Campaign Policy'] = {
    main: [[{ node: 'Load Blocklist Snapshot', type: 'main', index: 0 }]],
  };
  wf.connections['Load Blocklist Snapshot'] = {
    main: [[{ node: 'Load Manual Suppressions', type: 'main', index: 0 }]],
  };
  if (wf.connections['Load Suppressions']) {
    delete wf.connections['Load Suppressions'];
  }
  wf.connections['Load Manual Suppressions'] = {
    main: [[{ node: 'Idempotency Lookup', type: 'main', index: 0 }]],
  };

  fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2));
  console.log('Patched qualification-gate-mvp.json');
}

function patchPipedriveSync() {
  const wfPath = path.join(ROOT, 'n8n/workflows/pipedrive-suppression-sync.json');
  const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));

  const config = wf.nodes.find(n => n.name === 'config1');
  const assignments = config.parameters.assignments.assignments;
  if (!assignments.some(a => a.name === 'nocodb_blocklist_snapshots_table_id')) {
    assignments.push({
      id: 'cfg-20',
      name: 'nocodb_blocklist_snapshots_table_id',
      value: SNAPSHOT_TABLE_PLACEHOLDER,
      type: 'string',
    });
  }
  if (!assignments.some(a => a.name === 'snapshot_rebuild_max_pages')) {
    assignments.push({
      id: 'cfg-21',
      name: 'snapshot_rebuild_max_pages',
      value: '40',
      type: 'string',
    });
  }

  const ifNode = wf.nodes.find(n => n.name === 'More Pipedrive Pages?');
  if (ifNode) {
    ifNode.name = 'Sync Still Running?';
    ifNode.parameters.conditions.conditions[0] = {
      id: 'sync-incomplete',
      leftValue: '={{ $json.sync_complete }}',
      rightValue: false,
      operator: { type: 'boolean', operation: 'false' },
    };
  }

  let writeNode = wf.nodes.find(n => n.name === 'Write Blocklist Snapshot');
  if (!writeNode) {
    writeNode = {
      parameters: { jsCode: '// synced by scripts/sync-workflow-code.js\n' },
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [-200, 480],
      id: 'write-snapshot-001',
      name: 'Write Blocklist Snapshot',
    };
    wf.nodes.push(writeNode);
  }

  wf.connections['Sync Suppressions to NocoDB'] = {
    main: [[{ node: 'Sync Still Running?', type: 'main', index: 0 }]],
  };

  wf.connections['Sync Still Running?'] = {
    main: [
      [{ node: 'Fetch Pipedrive Customers', type: 'main', index: 0 }],
      [{ node: 'Write Blocklist Snapshot', type: 'main', index: 0 }],
    ],
  };

  fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2));
  console.log('Patched pipedrive-suppression-sync.json');
}

patchQualificationGate();
patchPipedriveSync();
