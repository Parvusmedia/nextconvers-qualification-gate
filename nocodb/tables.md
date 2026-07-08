# NocoDB Tables — NextConvers Qualification Gate

Create a new NocoDB **base/project** named **NextConvers Qualification Gate** on your NocoDB instance (e.g. `https://mpa.parvusmedia.com`).

After creating tables, copy each table ID into the n8n `config1` node.

## Conventions

| Convention | Value |
|------------|-------|
| Default policy fallback | `campaign_name = "__default__"` |
| Global suppressions | `campaign_name` left empty |
| Array fields | Store as **Long Text** containing JSON arrays, e.g. `["CEO","CFO"]` |
| Idempotency | `(source_row_id, campaign_name)` or `(linkedin_url, campaign_name)` |
| `crm_sync_status` | `pending`, `blocked`, `review`, `not_synced` |

---

## 1. clients

| Field | Type | Notes |
|-------|------|-------|
| id | ID | Auto |
| account_id | Single Line Text | NextConvers account ID; unique per client |
| client_name | Single Line Text | Display name |
| active | Checkbox | Default checked |
| created_at | DateTime | Auto on create |
| updated_at | DateTime | Auto on update |

---

## 2. campaign_policies

**Most important table.** All ICP and exclusion logic is editable here.

| Field | Type | Notes |
|-------|------|-------|
| id | ID | Auto |
| account_id | Single Line Text | FK to clients.account_id |
| campaign_name | Single Line Text | Exact match to NextConvers `campaign_name`; use `__default__` for fallback |
| product_name | Single Line Text | e.g. product being sold |
| motion_type | Single Select | `final_client`, `broker_channel`, `partner`, `other` |
| active | Checkbox | Only active policies are loaded |
| target_description | Long Text | Human-readable ICP description |
| allowed_countries | Long Text | JSON array of country codes or names |
| excluded_countries | Long Text | JSON array |
| allowed_industries | Long Text | JSON array |
| excluded_industries | Long Text | JSON array |
| target_roles | Long Text | JSON array |
| review_roles | Long Text | JSON array |
| excluded_roles | Long Text | JSON array |
| target_departments | Long Text | JSON array |
| excluded_departments | Long Text | JSON array |
| target_company_types | Long Text | JSON array |
| review_company_types | Long Text | JSON array |
| excluded_company_types | Long Text | JSON array |
| target_keywords | Long Text | JSON array |
| review_keywords | Long Text | JSON array |
| excluded_keywords | Long Text | JSON array |
| min_company_size | Number | Minimum employee count |
| max_company_size | Number | 0 = no max |
| min_profile_score | Number | Below → REJECTED |
| min_company_score | Number | Below → REJECTED or REVIEW |
| ready_for_crm_profile_score | Number | Required for READY_FOR_CRM |
| ready_for_crm_company_score | Number | Required for READY_FOR_CRM |
| review_if_profile_score_high_company_score_low | Checkbox | High profile + low company → REVIEW |
| require_no_suppression_match | Checkbox | Any suppression blocks CRM path |
| require_no_crm_duplicate | Checkbox | Future CRM integration |
| require_no_existing_customer | Checkbox | Future CRM integration |
| require_no_competitor | Checkbox | Future CRM integration |
| auto_ready_threshold | Number | Min positive signals for READY_FOR_CRM (default 1) |
| review_threshold | Number | Risk flags forcing REVIEW (default 1) |
| policy_notes | Long Text | Internal notes |
| created_at | DateTime | Auto |
| updated_at | DateTime | Auto |

---

## 3. suppression_entities

| Field | Type | Notes |
|-------|------|-------|
| id | ID | Auto |
| account_id | Single Line Text | |
| campaign_name | Single Line Text | Empty = account-global |
| entity_type | Single Select | See entity types below |
| entity_value | Single Line Text | Value to match |
| match_type | Single Select | `exact`, `contains`, `domain`, `linkedin_url`, `normalized_name` |
| reason | Single Select | `existing_customer`, `competitor`, `partner`, `provider`, `employee`, `not_icp`, `blocked_manually` |
| severity | Single Select | `reject` → SUPPRESSED; `review` → risk flag |
| active | Checkbox | |
| created_at | DateTime | Auto |
| updated_at | DateTime | Auto |

**entity_type values:** `company_name`, `company_domain`, `linkedin_company_url`, `person_linkedin_url`, `profile_id`, `headline_keyword`, `title_keyword`, `company_industry`, `company_type`, `email_domain`

**Pipedrive sync rows** use `match_type` `normalized_name` or `domain` with `reason=existing_customer` and empty `campaign_name`. These are compiled into `account_blocklist_snapshots` for fast lookup — do not load all rows per lead.

---

## 4. account_blocklist_snapshots

Compact exclusion index for bulk existing customers (e.g. Pipedrive sync). **One row per account.**

| Field | Type | Notes |
|-------|------|-------|
| id | ID | Auto |
| account_id | Single Line Text | Unique per account |
| chunk_index | Number | 0-based chunk for large name lists |
| customer_names_json | Long Text | JSON array of normalized company names (chunk) |
| customer_domains_json | Long Text | JSON array of domains |
| source | Single Line Text | e.g. `pipedrive`, `manual_rebuild` |
| name_count | Number | Count of names in snapshot |
| domain_count | Number | Count of domains in snapshot |
| updated_at | Single Line Text | ISO timestamp of last rebuild |

Rebuilt automatically when Pipedrive sync completes, or manually: `node scripts/rebuild-blocklist-snapshot.js`

---

## 5. company_identities

Manual and curated aliases linking legal names, brands, LinkedIn URLs, and domains to the same customer (`canonical_id`).

| Field | Type | Notes |
|-------|------|-------|
| account_id | Single Line Text | |
| canonical_id | Single Line Text | e.g. `pipedrive:12345` or manual slug |
| identity_type | Single Line Text | `legal_name`, `brand_name`, `linkedin_url`, `domain`, `document_id`, `alias` |
| identity_value | Single Line Text | Value to index in snapshot |
| match_strength | Single Line Text | `strong` (SUPPRESSED) or `review` (manual review only) |
| source | Single Line Text | `pipedrive`, `manual` |
| active | Checkbox | |
| notes | Long Text | Optional operator notes |

Merged into `account_blocklist_snapshots` on rebuild. Use for marca ≠ razón social when Pipedrive/LinkedIn data is incomplete.

---

## 6. lead_decisions

Audit log and review UI for all processed leads.

| Field | Type | Notes |
|-------|------|-------|
| id | ID | Auto |
| account_id | Single Line Text | |
| campaign_name | Single Line Text | Idempotency key |
| product_name | Single Line Text | From policy |
| motion_type | Single Line Text | From policy |
| source_row_id | Number | NextConvers row ID; idempotency key |
| profile_id | Single Line Text | |
| public_identifier | Single Line Text | |
| linkedin_url | Single Line Text | Idempotency fallback |
| profile_url | Single Line Text | |
| name | Single Line Text | |
| first_name | Single Line Text | |
| last_name | Single Line Text | |
| headline | Long Text | |
| country_code | Single Line Text | |
| country | Single Line Text | |
| state | Single Line Text | |
| city | Single Line Text | |
| location | Single Line Text | |
| company_name | Single Line Text | |
| company_linkedin_url | Long Text | |
| company_industry | Single Line Text | |
| current_position | Single Line Text | |
| current_company_description | Long Text | |
| summary | Long Text | |
| quick_summary | Long Text | |
| connections_count | Number | |
| follower_count | Number | |
| skills_text | Long Text | |
| top_skills_text | Long Text | |
| react_type | Single Line Text | |
| reacts_count | Number | |
| reacted_posts_count | Number | |
| post_url | Long Text | |
| profile_score | Number | |
| profile_score_summary | Long Text | |
| company_score | Number | |
| company_score_summary | Long Text | |
| current_company_employee_count | Number | |
| current_company_headquarter_city | Single Line Text | |
| current_company_headquarter_country | Single Line Text | |
| current_company_headquarter_region | Single Line Text | |
| email_enriched | Single Line Text | |
| qualification_status | Single Select | `READY_FOR_CRM`, `READY_FOR_REVIEW`, `REJECTED`, `SUPPRESSED` |
| qualification_confidence | Number | 0–100 |
| decision_reason | Long Text | Primary summary |
| reject_reason | Long Text | |
| review_reason | Long Text | |
| suppression_matches | Long Text | JSON array |
| risk_flags | Long Text | JSON array |
| positive_signals | Long Text | JSON array |
| crm_sync_status | Single Select | `pending`, `blocked`, `review`, `not_synced` |
| raw_payload | Long Text | Full original webhook JSON |
| created_at | DateTime | Auto |
| updated_at | DateTime | Auto |

---

## 7. feedback_events

Human review actions (future feedback loop; not used in MVP workflow).

| Field | Type | Notes |
|-------|------|-------|
| id | ID | Auto |
| lead_decision_id | Number | Link to lead_decisions.id |
| account_id | Single Line Text | |
| campaign_name | Single Line Text | |
| user_action | Single Select | See actions below |
| feedback_reason | Single Line Text | |
| notes | Long Text | |
| created_at | DateTime | Auto |

**user_action values:** `approve_for_crm`, `reject`, `reject_existing_customer`, `reject_competitor`, `reject_wrong_icp`, `reject_broker`, `reject_final_client`, `block_company`, `block_person`, `mark_as_customer`, `mark_as_competitor`

---

## 8. learned_rules

Future AI/feedback-driven rules (documented only; MVP does not read this table).

| Field | Type | Notes |
|-------|------|-------|
| id | ID | Auto |
| account_id | Single Line Text | |
| campaign_name | Single Line Text | |
| rule_type | Single Line Text | |
| pattern | Long Text | |
| decision | Single Select | Qualification status |
| confidence | Number | |
| active | Checkbox | |
| created_from_feedback_count | Number | |
| created_at | DateTime | Auto |
| updated_at | DateTime | Auto |

---

## 9. conversation_control

Future Unipile integration (documented only; MVP does not use this table).

| Field | Type | Notes |
|-------|------|-------|
| id | ID | Auto |
| account_id | Single Line Text | |
| linkedin_url | Long Text | |
| conversation_owner | Single Line Text | |
| automation_lock | Checkbox | |
| last_outbound_tool | Single Line Text | |
| last_inbound_message | Long Text | |
| last_outbound_message | Long Text | |
| reply_intent | Single Line Text | |
| interest_score | Number | |
| handoff_required | Checkbox | |
| next_action | Single Line Text | |
| created_at | DateTime | Auto |
| updated_at | DateTime | Auto |

---

## Table ID mapping for config1

After creating tables, set these in the n8n `config1` node:

```
nocodb_clients_table_id
nocodb_campaign_policies_table_id
nocodb_suppression_entities_table_id
nocodb_blocklist_snapshots_table_id
nocodb_company_identities_table_id
nocodb_lead_decisions_table_id
```

`clients` table is not queried in MVP workflow but should exist for operational reference.
