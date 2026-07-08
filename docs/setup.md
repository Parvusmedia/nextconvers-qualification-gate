# Setup Guide — NextConvers Qualification Gate

## Prerequisites

- n8n instance with Code node and HTTP Request node support
- NocoDB instance (e.g. `https://mpa.parvusmedia.com`)
- NextConvers configured to POST leads with `profile_score > 3` to your webhook URL

---

## Step 1: Create NocoDB base

1. Log in to NocoDB.
2. Create a new base/project: **NextConvers Qualification Gate**.
3. Create all 7 tables per [`nocodb/tables.md`](../nocodb/tables.md):
   - `clients`
   - `campaign_policies`
   - `suppression_entities`
   - `lead_decisions`
   - `feedback_events`
   - `learned_rules`
   - `conversation_control`

4. For array fields in `campaign_policies`, use **Long Text** column type.
5. Copy each table ID from NocoDB (table settings → API snippet).

---

## Step 2: Load seed data

Follow [`nocodb/seed-data.md`](../nocodb/seed-data.md):

1. Create Telefónica example client row.
2. Import two `campaign_policies` from `config/examples/`.
3. Add example `suppression_entities`.
4. Replace `REPLACE_WITH_TELEFONICA_ACCOUNT_ID` with your real account ID.

---

## Step 3: Import n8n workflow

1. In n8n: **Workflows → Import from File**.
2. Select [`n8n/workflows/qualification-gate-mvp.json`](../n8n/workflows/qualification-gate-mvp.json).
3. Open the **`config1`** node and set:

| Field | Value |
|-------|-------|
| `nocodb_base_url` | Your NocoDB URL |
| `nocodb_api_token` | API token with read/write on the base |
| `nocodb_clients_table_id` | Table ID |
| `nocodb_campaign_policies_table_id` | Table ID |
| `nocodb_suppression_entities_table_id` | Table ID |
| `nocodb_lead_decisions_table_id` | Table ID |

4. **Activate** the workflow.
5. Copy the production webhook URL from the **Webhook** node (path: `qualification-gate-mvp`).

See also: [`n8n-workflow.md`](n8n-workflow.md)

---

## Step 4: Register webhook in NextConvers

Configure NextConvers to POST the full lead payload to:

```
https://your-n8n.example.com/webhook/qualification-gate-mvp
```

Trigger condition: `profile_score > 3` (enforced on NextConvers side; the gate can apply stricter `min_profile_score` in policy).

Required payload fields:
- `account_id`
- `campaign_name`
- `profile_score`, `company_score`
- `id` (source row ID)
- Profile and company fields (see sample payload)

---

## Step 5: Test

```bash
export WEBHOOK_URL="https://your-n8n.example.com/webhook/qualification-gate-mvp"

curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d @tests/sample-payloads/nextconvers-sample-payload.json | jq .
```

Expected response shape:

```json
{
  "source_row_id": "987654",
  "linkedin_url": "https://www.linkedin.com/in/carlos-martinez-ciso",
  "campaign_name": "Cyberseguro - Cliente Final",
  "qualification_status": "READY_FOR_CRM",
  "qualification_confidence": 85,
  "decision_reason": "...",
  "risk_flags": [],
  "positive_signals": ["Target role match: CISO"],
  "crm_sync_status": "pending"
}
```

Verify the row appears in NocoDB `lead_decisions`.

More scenarios: [`tests/expected-decisions.md`](../tests/expected-decisions.md)

---

## Adding a new client or campaign (configuration only)

1. **New client:** Insert row in `clients` with `account_id` and `client_name`.
2. **New campaign:** Copy a policy from `config/examples/`, adapt fields, insert into `campaign_policies`.
3. **Blocklist:** Add rows to `suppression_entities`.
4. **Default fallback:** Create policy with `campaign_name = __default__`.

No n8n workflow changes required.

---

## Updating qualification logic

| Change | Where to edit |
|--------|---------------|
| Target/excluded roles | `campaign_policies.target_roles`, `excluded_roles` |
| Keywords | `campaign_policies.*_keywords` |
| Score thresholds | `campaign_policies.min_*`, `ready_for_crm_*` |
| Block competitors | `suppression_entities` |
| Geography | `campaign_policies.allowed_countries`, `excluded_countries` |

**Do not** edit n8n code nodes for client-specific changes.

---

## Troubleshooting

| Issue | Check |
|-------|-------|
| `No active policy found` | `campaign_policies` has active row for `account_id` + `campaign_name`, or `__default__` |
| NocoDB 401 | `nocodb_api_token` in `config1` |
| NocoDB 404 | Table IDs in `config1` |
| Empty `linkedin_url` | Payload `profile_url` or `reduced_profile_json_content` |
| Duplicate rows | Same `source_row_id` + `campaign_name` should upsert; check idempotency lookup |

---

## Code node maintenance

Source files live in `n8n/code-nodes/`. After editing:

1. Re-run the workflow generator or manually update inlined code in `qualification-gate-mvp.json`.
2. Re-import or paste updated code into n8n nodes.

Shared libraries in `n8n/code-nodes/lib/` are inlined into `evaluate-hard-rules.js` for n8n compatibility.
