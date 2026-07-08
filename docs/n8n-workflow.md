# n8n Workflow — Qualification Gate MVP

**File:** [`n8n/workflows/qualification-gate-mvp.json`](../n8n/workflows/qualification-gate-mvp.json)

**Workflow name:** `NextConvers Qualification Gate - MVP`

## Import

1. n8n → **Workflows** → **Import from File**
2. Select `qualification-gate-mvp.json`
3. Edit **`config1`** node only (see below)
4. **Activate** workflow

## Configuration node (`config1`)

| Variable | Description |
|----------|-------------|
| `nocodb_base_url` | e.g. `https://mpa.parvusmedia.com` |
| `nocodb_api_token` | API token with access to the Qualification Gate base |
| `nocodb_clients_table_id` | `clients` table ID (reference only in MVP) |
| `nocodb_campaign_policies_table_id` | `campaign_policies` table ID |
| `nocodb_suppression_entities_table_id` | `suppression_entities` table ID |
| `nocodb_lead_decisions_table_id` | `lead_decisions` table ID |

## Webhook

- **Method:** POST
- **Path:** `qualification-gate`
- **Response mode:** Respond to Webhook node (last step)

Production URL format:
```
https://{n8n-host}/webhook/qualification-gate
```

## Node pipeline

```
Webhook
  → config1
  → Normalize Lead
  → Load Campaign Policy (HTTP GET — all active policies for account)
  → Load Suppressions (HTTP GET)
  → Idempotency Lookup (HTTP GET)
  → Merge Context
  → Evaluate Hard Rules
  → Build Decision Output
  → Save Lead Decision (HTTP POST/PATCH)
  → Respond to Webhook
```

## Node details

### Normalize Lead
- Source: `n8n/code-nodes/normalize-lead.js`
- Reads webhook body via `$('Webhook')`
- Outputs stable normalized lead object

### Load Campaign Policy
```
GET /api/v2/tables/{campaign_policies}/records
where=(account_id,eq,{account_id})~and(active,eq,true)
limit=50
```

Merge Context filters in-memory by `campaign_name` (exact match first, then `__default__`). This avoids NocoDB `where` encoding issues when campaign names contain spaces.

### Load Default Policy (deprecated in pipeline)

The workflow no longer calls a separate default-policy HTTP node. Default policy (`campaign_name = __default__`) is selected from the same account-level policy list in **Merge Context**.

Merge Context picks exact policy first, then default.

### Load Suppressions
```
where=(account_id,eq,{account_id})~and(active,eq,true)
limit=100
```

Merge Context filters to global (empty campaign_name) + matching campaign.

### Idempotency Lookup
```
where=(source_row_id,eq,{source_row_id})
limit=10
```

Merge Context filters results by `campaign_name` in-memory.

### Evaluate Hard Rules
- Source: `n8n/code-nodes/evaluate-hard-rules.js`
- Pure config-driven evaluation

### Build Decision Output
- Source: `n8n/code-nodes/build-decision-output.js`
- Produces `webhook_response` + `lead_decisions` row fields

### Save Lead Decision
- PATCH if `existing_decision_id` found
- POST otherwise

### Respond to Webhook
Returns `webhook_response` JSON:

```json
{
  "source_row_id": "",
  "linkedin_url": "",
  "campaign_name": "",
  "qualification_status": "",
  "qualification_confidence": 0,
  "decision_reason": "",
  "risk_flags": [],
  "positive_signals": [],
  "crm_sync_status": ""
}
```

## Updating code nodes

1. Edit files in `n8n/code-nodes/`
2. Regenerate workflow JSON (inline code into nodes) or copy-paste into n8n UI
3. Test with sample payload

**Never add client-specific logic to code nodes.** Use NocoDB config.

## Register in NextConvers

Point NextConvers webhook (for leads with `profile_score > 3`) to the production webhook URL.

Required payload fields: see [`tests/sample-payloads/nextconvers-sample-payload.json`](../tests/sample-payloads/nextconvers-sample-payload.json).

## Monitoring

- n8n execution history — failed HTTP calls, code errors
- NocoDB `lead_decisions` — all decisions with timestamps
- Filter `qualification_status = READY_FOR_REVIEW` for human review queue

---

## Relationship to Pipedrive sync workflow

| Workflow | File | Trigger | Calls Pipedrive? |
|----------|------|---------|------------------|
| **Qualification Gate** (this doc) | `qualification-gate-mvp.json` | Webhook per lead | **No** |
| **Pipedrive Suppression Sync** | `pipedrive-suppression-sync.json` | Hourly schedule | **Yes** |

Blueprint for Workflow 2: [`pipedrive-suppression-sync.md`](pipedrive-suppression-sync.md)

### Does this workflow need changes for Pipedrive?

**No Pipedrive integration here.** The sync workflow writes to `suppression_entities`; this workflow only reads that table.

### Changes already applied in repo

| Change | Why |
|--------|-----|
| Webhook path `qualification-gate` | Matches production URL |
| Policy load without `campaign_name` in URL | Spaces in campaign names broke NocoDB filter |
| `policy.Id` support | NocoDB returns `Id` not `id` |
| `Load Suppressions` limit `2000` | Was 100 |

### When you must change this workflow again

| Condition | Required change |
|-----------|-----------------|
| Fewer than ~2,000 active suppression rows | **No change** — current design is fine |
| More than ~2,000 suppression rows (after Pipedrive sync) | Replace `Load Suppressions` with snapshot lookup or targeted queries — see [`scale-architecture.md`](scale-architecture.md) |

Until then: import the latest `qualification-gate-mvp.json`, keep `config1` tokens current, stay activated.

