# Operator Checklist — What Cursor cannot do

Cursor completed the full MVP codebase locally. The steps below require **your credentials and external systems**.

## Done by Cursor (local)

- [x] Project at `/opt/apps/nextconvers-qualification-gate`
- [x] All docs, config schema, example policies
- [x] n8n workflow JSON + code nodes
- [x] NocoDB table definitions + seed instructions
- [x] Sample payload + expected decisions
- [x] Local smoke test script
- [x] Cursor project rules (`.cursor/rules/`)

Run local tests anytime:

```bash
node scripts/run-local-qualification-test.js
```

---

## Requires you (external systems)

### 1. NocoDB — create base and tables

**Why Cursor cannot:** needs your NocoDB login on `mpa.parvusmedia.com` and UI access to create a new base.

| Step | Action |
|------|--------|
| 1 | Log in to NocoDB |
| 2 | Create base **NextConvers Qualification Gate** |
| 3 | Create 7 tables per [`nocodb/tables.md`](../nocodb/tables.md) |
| 4 | Copy each table ID |
| 5 | Load seed data from [`nocodb/seed-data.md`](../nocodb/seed-data.md) |
| 6 | Replace `REPLACE_WITH_TELEFONICA_ACCOUNT_ID` with real NextConvers account ID |
| 7 | Create API token with read/write on this base |

### 2. n8n — import workflow and configure secrets

**Why Cursor cannot:** needs access to your n8n instance and API token (secret).

| Step | Action |
|------|--------|
| 1 | Import [`n8n/workflows/qualification-gate-mvp.json`](../n8n/workflows/qualification-gate-mvp.json) |
| 2 | Open `config1` node |
| 3 | Set `nocodb_base_url`, `nocodb_api_token`, all table IDs |
| 4 | Activate workflow |
| 5 | Copy production webhook URL |

### 3. NextConvers — register webhook

**Why Cursor cannot:** NextConvers core is external; webhook registration is in your NextConvers admin.

| Step | Action |
|------|--------|
| 1 | Configure webhook URL: `https://{n8n-host}/webhook/qualification-gate-mvp` |
| 2 | Trigger when `profile_score > 3` |
| 3 | Ensure payload includes `account_id`, `campaign_name`, scores, profile fields |

### 4. End-to-end test against live stack

**Why Cursor cannot:** needs live n8n webhook + populated NocoDB.

```bash
export WEBHOOK_URL="https://your-n8n.example.com/webhook/qualification-gate-mvp"
curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d @tests/sample-payloads/nextconvers-sample-payload.json | jq .
```

Verify row in NocoDB `lead_decisions`.

### 5. Git remote (optional)

**On this VPS:** `git push` is preconfigured for this repo via local `core.sshCommand` (org key). Use:

```bash
git push
# or
./scripts/git-push.sh
```

Remote: `git@github.com:Parvusmedia/nextconvers-qualification-gate.git`

---

## Quick reference: secrets only you have

| Secret | Where it goes |
|--------|---------------|
| NocoDB API token | n8n `config1` → `nocodb_api_token` |
| NocoDB table IDs | n8n `config1` → `nocodb_*_table_id` |
| NextConvers account_id | NocoDB `clients` + `campaign_policies` + seed data |
| n8n webhook URL | NextConvers webhook config |

---

## After go-live: config-only changes

No code deploy needed for:

- New campaigns → insert `campaign_policies` row
- New blocklist → insert `suppression_entities` row
- ICP tuning → edit arrays in `campaign_policies`
