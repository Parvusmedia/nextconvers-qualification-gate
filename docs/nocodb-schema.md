# NocoDB Schema Reference

Full table definitions for the **NextConvers Qualification Gate** base. For creation steps, see [`nocodb/tables.md`](../nocodb/tables.md).

## Base name

**NextConvers Qualification Gate** (dedicated base, separate from automation_limits)

## Tables summary

| # | Table | MVP usage |
|---|-------|-----------|
| 1 | clients | Reference registry |
| 2 | campaign_policies | **Active** — ICP engine |
| 3 | suppression_entities | **Active** — blocklist |
| 4 | lead_decisions | **Active** — audit log |
| 5 | feedback_events | Documented only |
| 6 | learned_rules | Documented only |
| 7 | conversation_control | Documented only |

---

## clients

Tenant registry linking NextConvers `account_id` to a display name.

**Key field:** `account_id` — must match the `account_id` in webhook payloads.

---

## campaign_policies

The editable ICP engine. One row per campaign (plus optional `__default__` fallback).

### Array fields (Long Text, JSON format)

```
target_roles, review_roles, excluded_roles
target_departments, excluded_departments
target_company_types, review_company_types, excluded_company_types
target_keywords, review_keywords, excluded_keywords
allowed_countries, excluded_countries
allowed_industries, excluded_industries
```

**UI tip:** In NocoDB grid view, click cell → paste JSON array. Validate against [`config/qualification-policy.schema.json`](../config/qualification-policy.schema.json).

### Threshold fields

| Field | Type | Description |
|-------|------|-------------|
| min_profile_score | Number | Hard floor; below = REJECTED |
| min_company_score | Number | Hard floor; below = REJECTED or REVIEW |
| ready_for_crm_profile_score | Number | CRM path requirement |
| ready_for_crm_company_score | Number | CRM path requirement |
| auto_ready_threshold | Number | Min positive signals for CRM |
| review_threshold | Number | Risk flags forcing review |
| min_company_size | Number | Employee count floor |
| max_company_size | Number | 0 = no limit |

### Boolean flags

| Field | Effect |
|-------|--------|
| review_if_profile_score_high_company_score_low | High profile + low company → REVIEW |
| require_no_suppression_match | Any suppression match blocks CRM |
| require_no_crm_duplicate | Future CRM use |
| require_no_existing_customer | Future CRM use |
| require_no_competitor | Future CRM use |

---

## suppression_entities

Blocklist for competitors, customers, and manual blocks.

| Field | Notes |
|-------|-------|
| campaign_name | Empty = applies to all campaigns for account |
| entity_type | What field to match against (see tables.md) |
| entity_value | Value to match |
| match_type | How to match (exact, contains, domain, etc.) |
| severity | `reject` or `review` |
| reason | Categorical reason for audit |

### Recommended operational use

- Existing customers or excluded client accounts: add rows here, usually with `entity_type = company_name` or `company_domain`, `severity = reject`.
- Competitors: add rows here, usually with `entity_type = company_domain`, `company_name`, or `company_type`, depending on how stable the source data is.
- People or profiles you never want to route: use `person_linkedin_url`, `profile_id`, or keyword-based rows like `headline_keyword`.
- Use empty `campaign_name` for account-wide exclusions, or set `campaign_name` to scope the suppression to one motion/campaign.

---

## lead_decisions

One row per qualified lead (idempotent upsert).

### Idempotency

Primary key logic (not DB constraint):
- `(source_row_id, campaign_name)`
- Fallback: `(linkedin_url, campaign_name)`

### JSON storage fields

Stored as Long Text JSON strings:
- `suppression_matches`
- `risk_flags`
- `positive_signals`
- `raw_payload`

### Review UI

Filter views in NocoDB:
- `qualification_status = READY_FOR_REVIEW` — human review queue
- `qualification_status = READY_FOR_CRM` AND `crm_sync_status = pending` — future CRM queue
- `qualification_status = SUPPRESSED` — blocked leads

---

## feedback_events (future)

Captures human reviewer actions. Links to `lead_decisions.id` via `lead_decision_id`.

Used to train `learned_rules` in a future iteration.

---

## learned_rules (future)

Pattern-based rules derived from feedback. Not read by MVP workflow.

---

## conversation_control (future)

Per-LinkedIn-profile automation state for Unipile integration. Not used in MVP.

---

## API access

n8n uses NocoDB API v2:

```
GET  /api/v2/tables/{tableId}/records?where=(field,eq,value)
POST /api/v2/tables/{tableId}/records
PATCH /api/v2/tables/{tableId}/records  { "id": 1, ...fields }
```

Header: `xc-token: {api_token}`

---

## Example policies

See [`config/examples/`](../config/examples/) and [`nocodb/seed-data.md`](../nocodb/seed-data.md).

---

## What operators must maintain

For the MVP decision tree to work well, the team should actively maintain:

1. `clients`
   - One row per NextConvers tenant/account.
   - `account_id` must exactly match the incoming webhook payload.

2. `campaign_policies`
   - One active row per campaign you want to classify.
   - Optional `__default__` row per account as a fallback.
   - Fill target roles, exclusions, geography, industries, company-type hints, and thresholds here.

3. `suppression_entities`
   - Competitors, current customers, blocked companies, blocked domains, blocked profiles, and special-case manual exclusions.
   - This is the main place to maintain exclusion lists.

If those three tables are current, the rest of the tree runs automatically. `lead_decisions` is output/audit storage, not an input table.
