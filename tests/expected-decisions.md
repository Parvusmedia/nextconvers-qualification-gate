# Expected Decisions — Test Scenarios

Use these scenarios to validate the Qualification Gate after deploying NocoDB seed data and the n8n workflow.

**Prerequisites:**
- Telefónica seed policies loaded from [`nocodb/seed-data.md`](../nocodb/seed-data.md)
- `account_id` in payloads matches seed data
- Workflow active with correct table IDs in `config1`

---

## Scenario 1: CEO at target company → READY_FOR_CRM

**Policy:** `Cyberseguro - Cliente Final`

**Payload overrides:**
```json
{
  "campaign_name": "Cyberseguro - Cliente Final",
  "headline": "CEO at Acme Retail Group",
  "current_position": "Chief Executive Officer",
  "company_name": "Acme Retail Group",
  "company_industry": "Retail",
  "profile_score": 4,
  "company_score": 4,
  "current_company_employeeCount": 250,
  "country_code": "ES"
}
```

**Expected webhook response:**
| Field | Expected |
|-------|----------|
| `qualification_status` | `READY_FOR_CRM` |
| `qualification_confidence` | ≥ 75 |
| `crm_sync_status` | `pending` |
| `positive_signals` | Contains target role match |
| `risk_flags` | `[]` |

---

## Scenario 2: Insurance broker → READY_FOR_CRM (brokers policy)

**Policy:** `Cyberseguro - Brokers`

**Payload overrides:**
```json
{
  "campaign_name": "Cyberseguro - Brokers",
  "headline": "Insurance Broker | Corredor de seguros",
  "current_position": "Insurance Broker",
  "company_name": "Seguros Pyme Correduría",
  "company_industry": "Insurance",
  "current_company_description": "Commercial insurance brokerage for SME clients",
  "profile_score": 4,
  "company_score": 3,
  "current_company_employeeCount": 15,
  "country_code": "ES"
}
```

**Expected:**
| Field | Expected |
|-------|----------|
| `qualification_status` | `READY_FOR_CRM` |
| `positive_signals` | Target role and/or company type match |

---

## Scenario 3: Insurance broker → REJECTED (final-client policy)

**Policy:** `Cyberseguro - Cliente Final`

**Payload overrides:**
```json
{
  "campaign_name": "Cyberseguro - Cliente Final",
  "headline": "Insurance Broker at Seguros Pyme",
  "current_position": "Insurance Broker",
  "profile_score": 4,
  "company_score": 3
}
```

**Expected:**
| Field | Expected |
|-------|----------|
| `qualification_status` | `REJECTED` |
| `decision_reason` | Contains excluded role match |
| `crm_sync_status` | `blocked` |

---

## Scenario 4: Recruiter headline → REJECTED

**Policy:** `Cyberseguro - Cliente Final`

**Payload overrides:**
```json
{
  "campaign_name": "Cyberseguro - Cliente Final",
  "headline": "Talent Acquisition Specialist | Tech Recruiter",
  "current_position": "Senior Recruiter",
  "profile_score": 4,
  "company_score": 4
}
```

**Expected:**
| Field | Expected |
|-------|----------|
| `qualification_status` | `REJECTED` |
| `decision_reason` | Excluded role or keyword match |

---

## Scenario 5: Competitor in suppression list → SUPPRESSED

**Policy:** `Cyberseguro - Cliente Final`

**Prerequisite:** Suppression entity with `entity_value: Movistar`, `severity: reject`

**Payload overrides:**
```json
{
  "campaign_name": "Cyberseguro - Cliente Final",
  "company_name": "Movistar Empresas",
  "headline": "IT Manager at Movistar",
  "profile_score": 5,
  "company_score": 5
}
```

**Expected:**
| Field | Expected |
|-------|----------|
| `qualification_status` | `SUPPRESSED` |
| `decision_reason` | Suppression match |
| `crm_sync_status` | `blocked` |

---

## Scenario 6: High profile / low company score → READY_FOR_REVIEW

**Policy:** `Cyberseguro - Cliente Final` (with `review_if_profile_score_high_company_score_low: true`)

**Payload overrides:**
```json
{
  "campaign_name": "Cyberseguro - Cliente Final",
  "headline": "CISO at Acme Retail Group",
  "current_position": "Chief Information Security Officer",
  "profile_score": 5,
  "company_score": 1,
  "current_company_employeeCount": 250,
  "country_code": "ES"
}
```

**Expected:**
| Field | Expected |
|-------|----------|
| `qualification_status` | `READY_FOR_REVIEW` |
| `decision_reason` | High profile score with low company score |
| `crm_sync_status` | `review` |

---

## Scenario 7: Unknown campaign, no default policy → READY_FOR_REVIEW

**Policy:** None matching

**Payload overrides:**
```json
{
  "campaign_name": "Unknown Campaign XYZ",
  "profile_score": 4,
  "company_score": 4
}
```

**Expected:**
| Field | Expected |
|-------|----------|
| `qualification_status` | `READY_FOR_REVIEW` |
| `decision_reason` | `No active policy found` |
| `crm_sync_status` | `review` |

---

## Scenario 8: Idempotent re-processing

**Steps:**
1. Send sample payload from [`nextconvers-sample-payload.json`](sample-payloads/nextconvers-sample-payload.json)
2. Send the same payload again (same `id` / `source_row_id` and `campaign_name`)

**Expected:**
- Same `qualification_status` on both responses
- `lead_decisions` table has **one** row updated (not duplicated)
- `updated_at` changes on second request

---

## Running tests

```bash
# Base sample (Scenario 1 baseline)
curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d @tests/sample-payloads/nextconvers-sample-payload.json | jq .

# Custom scenario (merge overrides with jq)
jq '.headline = "Talent Acquisition Specialist"' \
  tests/sample-payloads/nextconvers-sample-payload.json | \
  curl -s -X POST "$WEBHOOK_URL" -H "Content-Type: application/json" -d @- | jq .
```

Replace `$WEBHOOK_URL` with your n8n production webhook URL.
