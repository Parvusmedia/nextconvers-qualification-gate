# NextConvers Qualification Gate

External, reusable qualification gate for NextConvers leads. Receives full lead payloads via webhook when `profile_score > 3`, classifies each lead, stores audit-friendly decisions in NocoDB, and returns a structured JSON response.

**This project does not modify the NextConvers core product.**

## Status outcomes

| Status | Meaning |
|--------|---------|
| `READY_FOR_CRM` | Meets ICP thresholds; eligible for CRM sync (MVP: stored only, not synced) |
| `READY_FOR_REVIEW` | Potentially relevant but ambiguous; human review recommended |
| `REJECTED` | Clearly outside ICP per campaign policy |
| `SUPPRESSED` | Matched a critical suppression rule (competitor, customer, blocklist) |

## Stack

- **n8n** — orchestration (webhook, NocoDB API, code nodes)
- **NocoDB** — operational database, review UI, editable configuration
- **Future:** CRM sync, AI qualification, Unipile conversation automation (not in MVP)

## Architecture principle

All client-specific ICP and exclusion logic lives in **editable NocoDB configuration** (`campaign_policies`, `suppression_entities`). The n8n workflow and code nodes contain zero hardcoded client, campaign, or role logic.

## Quick start

1. Create a new NocoDB base **"NextConvers Qualification Gate"** on your NocoDB instance — see [nocodb/tables.md](nocodb/tables.md).
2. Load example seed data — see [nocodb/seed-data.md](nocodb/seed-data.md).
3. Import the n8n workflow from [n8n/workflows/qualification-gate-mvp.json](n8n/workflows/qualification-gate-mvp.json) — see [docs/setup.md](docs/setup.md).
4. Edit only the `config1` node: set `nocodb_api_token` and table IDs.
5. Register the webhook URL in NextConvers for leads with `profile_score > 3`.
6. Test:

```bash
curl -X POST "https://your-n8n.example.com/webhook/qualification-gate" \
  -H "Content-Type: application/json" \
  -d @tests/sample-payloads/nextconvers-sample-payload.json
```

## Project structure

```
docs/           Architecture, setup, qualification logic, NocoDB schema, n8n workflow
config/         JSON Schema + example campaign policies (Telefónica Cyberseguro)
n8n/            Importable workflow + reusable code nodes
nocodb/         Table definitions + seed data instructions
tests/          Sample payloads + expected decision scenarios
```

## Adding a new client or campaign

Configuration only — no workflow changes:

1. Insert a row in `clients` with the NextConvers `account_id`.
2. Insert one or more rows in `campaign_policies` for each campaign (or a `__default__` fallback).
3. Optionally add rows in `suppression_entities` for blocklists.

See [docs/setup.md](docs/setup.md) for details.

## Documentation

- [Architecture](docs/architecture.md)
- [Setup guide](docs/setup.md)
- [Operator checklist](docs/operator-checklist.md) — what Cursor cannot do (NocoDB, n8n, NextConvers)
- [Qualification logic](docs/qualification-logic.md)
- [NocoDB schema](docs/nocodb-schema.md)
- [n8n workflow](docs/n8n-workflow.md)
- [Pipedrive suppression sync](docs/pipedrive-suppression-sync.md)
- [Scale architecture (16k+ orgs)](docs/scale-architecture.md)

## Local tests (no external services)

```bash
node scripts/run-local-qualification-test.js
```

## MVP scope (included)

- Webhook intake and payload normalization
- Config-driven hard-rule qualification
- Suppression entity matching
- Idempotent lead_decision upsert
- Audit logging with raw payload
- Webhook JSON response

## MVP scope (excluded)

- CRM automatic sync
- AI qualification
- Unipile / LinkedIn messaging
- Skylead response automation
- `learned_rules` and `conversation_control` table usage
