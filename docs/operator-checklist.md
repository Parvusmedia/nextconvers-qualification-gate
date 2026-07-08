# Operator Checklist — What Cursor cannot do

Cursor completed the full MVP codebase locally. The steps below require **your credentials and external systems**.

## Done by Cursor (local + VPS)

- [x] Project at `/opt/apps/nextconvers-qualification-gate`
- [x] All docs, config schema, example policies
- [x] n8n workflow JSON + code nodes (table IDs patched from live deploy)
- [x] Sample payload + expected decisions
- [x] Local smoke test: `node scripts/run-local-qualification-test.js`
- [x] **NocoDB provisioned** on `mpa.parvusmedia.com` (base `phh986hkgi1daju`, tables `qg_*`)
- [x] **Seed data loaded** (Telefónica example policies + suppressions)
- [x] **Live integration test passed**: `node scripts/run-live-qualification.js` → `READY_FOR_CRM`, row Id 1
- [x] Config written: [`config/deployment.generated.json`](../config/deployment.generated.json)

### NocoDB table IDs (live)

| Table | ID |
|-------|-----|
| qg_clients | `m7o4my63fuqikeg` |
| qg_campaign_policies | `mgihvzrry4yo0yi` |
| qg_suppression_entities | `mq2uddkho8cyepg` |
| qg_lead_decisions | `mikb7c7krp5kpfm` |

Re-provision anytime: `node scripts/provision-nocodb.js`

---

## Requires you (remaining steps)

### 1. n8n — import workflow and set API token

**n8n host:** `https://pmedia.app.n8n.cloud`

| Step | Action |
|------|--------|
| 1 | Import [`n8n/workflows/qualification-gate-mvp.json`](../n8n/workflows/qualification-gate-mvp.json) |
| 2 | Open `config1` → set `nocodb_api_token` (NocoDB token with write access) |
| 3 | Table IDs are **already set** in workflow JSON |
| 4 | Activate workflow |
| 5 | Webhook URL: `https://pmedia.app.n8n.cloud/webhook/qualification-gate-mvp` |
| 6 | Test: `./scripts/test-n8n-webhook.sh` |

### 2. NextConvers — register webhook

| Step | Action |
|------|--------|
| 1 | Point webhook to `https://pmedia.app.n8n.cloud/webhook/qualification-gate-mvp` |
| 2 | Trigger when `profile_score > 3` |
| 3 | Ensure `account_id` in payload matches seeded value (`rq1lQcYTToC9hlWD4vO94g` or update seed) |

### 3. NocoDB — optional: dedicated base

Tables were created in the **automation base** (`phh986hkgi1daju`) with `qg_` prefix because the API token cannot create new bases. To move to a dedicated base later, create base in NocoDB UI and re-run provision with `NOCODB_BASE_ID=...`.

---

## Removed / completed (was blocking)

~~NocoDB create base and tables~~ — done via `scripts/provision-nocodb.js`  
~~Load Telefónica seed~~ — done  
~~End-to-end NocoDB test~~ — done via `scripts/run-live-qualification.js`

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
