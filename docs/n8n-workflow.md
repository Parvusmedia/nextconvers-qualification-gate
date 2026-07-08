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
- **Path:** `qualification-gate-mvp`
- **Response mode:** Respond to Webhook node (last step)

Production URL format:
```
https://{n8n-host}/webhook/qualification-gate-mvp
```

## Node pipeline

```
Webhook
  → config1
  → Normalize Lead
  → Load Campaign Policy (HTTP GET)
  → Load Default Policy (HTTP GET)
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
where=(account_id,eq,{account_id})~and(campaign_name,eq,{campaign_name})~and(active,eq,true)
limit=1
```

### Load Default Policy
```
where=(account_id,eq,{account_id})~and(campaign_name,eq,__default__)~and(active,eq,true)
limit=1
```

Merge Context picks exact policy first, then default.

### Load Suppressions
```
where=(account_id,eq,{account_id})~and(active,eq,true)
limit=100
```

Merge Context filters to global (empty campaign_name) + matching campaign.

### Idempotency Lookup
```
where=(source_row_id,eq,{source_row_id})~and(campaign_name,eq,{campaign_name})
limit=1
```

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
