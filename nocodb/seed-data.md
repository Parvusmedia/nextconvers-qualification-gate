# NocoDB Seed Data — Telefónica Cyberseguro (Example)

This seed data is **editable configuration only**. It demonstrates how to set up a client without changing workflow code.

Replace `REPLACE_WITH_TELEFONICA_ACCOUNT_ID` with the real NextConvers `account_id`.

---

## Step 1: Create client

| account_id | client_name | active |
|------------|-------------|--------|
| `REPLACE_WITH_TELEFONICA_ACCOUNT_ID` | Telefónica (example) | true |

---

## Step 2: Create campaign policies

Import from JSON files or paste field values manually:

- [`config/examples/telefonica-cyberseguro-final-client.json`](../config/examples/telefonica-cyberseguro-final-client.json)
- [`config/examples/telefonica-cyberseguro-brokers.json`](../config/examples/telefonica-cyberseguro-brokers.json)

**NocoDB tip:** For array fields (`target_roles`, `excluded_keywords`, etc.), paste the JSON array as Long Text:

```json
["CEO", "Founder", "CFO"]
```

---

## Step 3: Create suppression entities (examples)

| account_id | campaign_name | entity_type | entity_value | match_type | reason | severity | active |
|------------|---------------|-------------|--------------|------------|--------|----------|--------|
| `REPLACE_WITH_TELEFONICA_ACCOUNT_ID` | | `company_name` | Movistar | contains | existing_customer | reject | true |
| `REPLACE_WITH_TELEFONICA_ACCOUNT_ID` | | `company_name` | Telefónica | contains | existing_customer | reject | true |
| `REPLACE_WITH_TELEFONICA_ACCOUNT_ID` | Cyberseguro - Cliente Final | `headline_keyword` | recruiter | contains | not_icp | reject | true |
| `REPLACE_WITH_TELEFONICA_ACCOUNT_ID` | | `company_domain` | competitor-insurance.example | domain | competitor | reject | true |
| `REPLACE_WITH_TELEFONICA_ACCOUNT_ID` | Cyberseguro - Brokers | `company_type` | insurance company competitor | contains | competitor | review | true |

**Notes:**
- Empty `campaign_name` = applies to all campaigns for that account.
- Edit or delete rows anytime in NocoDB; changes take effect on the next webhook.

---

## Step 4: Optional default policy

If NextConvers sends leads with unknown `campaign_name`, create a fallback:

| account_id | campaign_name | product_name | active | min_profile_score | policy_notes |
|------------|---------------|--------------|--------|-------------------|--------------|
| `REPLACE_WITH_TELEFONICA_ACCOUNT_ID` | `__default__` | Cyberseguro | true | 4 | Catch-all policy when no exact campaign match |

---

## Step 5: Verify in NocoDB

1. Open `campaign_policies` — confirm both Cyberseguro campaigns are `active`.
2. Open `suppression_entities` — confirm example rows are `active`.
3. Send a test webhook (see [tests/sample-payloads](../tests/sample-payloads/)).
4. Check `lead_decisions` for the stored result.

---

## Adding a new client (configuration only)

1. Insert row in `clients`.
2. Copy and adapt a `campaign_policies` JSON from `config/examples/`.
3. Add `suppression_entities` as needed.
4. No n8n workflow changes required.
