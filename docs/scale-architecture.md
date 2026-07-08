# Scale Architecture — Pipedrive + NocoDB + Qualification

This document explains **how many API calls** each part of the system makes, where bottlenecks appear at ~16,000 Pipedrive organizations, and the recommended target architecture.

---

## Two separate workflows (do not mix them)

| Workflow | When it runs | Purpose |
|----------|--------------|---------|
| **Pipedrive → Suppression Sync** | Hourly (scheduled) | Download customer orgs from Pipedrive, update NocoDB |
| **Qualification Gate** | On every lead webhook | Load policy + check exclusions + decide |

The qualification webhook must **never** call Pipedrive. All customer data must already be in NocoDB (or a snapshot) before the lead arrives.

---

## Part 1: Pipedrive sync — how many calls?

### Does it call Pipedrive once per company?

**No.** Pipedrive does not require one API call per organization.

The sync uses **paginated list download**:

```
GET /v1/organizations?start=0&limit=500     → 500 orgs as JSON
GET /v1/organizations?start=500&limit=500   → next 500
...
```

| Total orgs in Pipedrive | Pages (500/page) | Pipedrive API calls |
|-------------------------|------------------|---------------------|
| 16,000 | 32 | **~32 calls** |
| 16,000 with `filter_id` (only customers) | 2–10 (depends on filter) | **2–10 calls** |

Each response is already JSON with hundreds of organizations. There is no separate “download all as one file” endpoint — pagination **is** the bulk download.

### Does it call NocoDB once per company?

**Today: yes — this is the real bottleneck.**

For each customer organization the sync may write:
- 1 row for `company_name`
- 1 row for `company_domain` (if website exists)

| Customers synced | suppression rows | NocoDB writes (current) |
|------------------|-------------------|-------------------------|
| 2,000 | ~4,000 | **~4,000 HTTP calls** |
| 8,000 | ~16,000 | **~16,000 HTTP calls** |
| 16,000 | ~32,000 | **~32,000 HTTP calls** |

At 16k customers, a full sync can take **hours** and hit n8n timeouts even though Pipedrive only needed ~32 calls.

**Improvement available now:** NocoDB supports **bulk insert** (array of records in one POST). Batching 200–500 rows per call reduces writes from 32,000 → **~64–160 calls**.

---

## Part 2: Qualification webhook — how many calls?

Per incoming lead, the qualification workflow currently does:

| Step | API | Calls |
|------|-----|-------|
| Load policies | NocoDB GET | 1 |
| Load suppressions | NocoDB GET (`limit=2000`) | 1 |
| Idempotency check | NocoDB GET | 1 |
| Save decision | NocoDB POST/PATCH | 1 |
| **Total per lead** | | **~4 NocoDB calls** |

Pipedrive: **0 calls** (correct).

### Problem: loading thousands of suppression rows per lead

Current logic:

1. Download up to **2,000** suppression rows from NocoDB
2. Loop **every row** in JavaScript to see if the lead's company matches

| Suppression rows | Payload size | Match time | Risk |
|------------------|--------------|------------|------|
| 100 | Small | <1 ms | None |
| 2,000 | ~500 KB | ~5–20 ms | OK |
| 16,000+ | Several MB | 50–200 ms+ | Slow; rows beyond `limit` are **ignored** |

So with 16k customers you get **wrong results** (missed exclusions) **and** slower webhooks.

There is **no wait** configured today — the issue is volume and the `limit` cap, not intentional delays.

---

## Part 3: Organizations vs persons

| Source | Sync for existing customers? | Reason |
|--------|------------------------------|--------|
| **Organizations** | **Yes** | Lead carries `company_name` / domain |
| **Persons** | **No** | Person at client company is blocked via org match |

Person sync would multiply rows (contacts × companies) without improving company-level exclusion.

---

## Recommended target architecture

### Principle

| Layer | Pattern | Frequency |
|-------|---------|-----------|
| **Sync (batch)** | Download bulk from Pipedrive, write compact blocklist to NocoDB | Hourly |
| **Qualify (real-time)** | Small, fast lookups — never scan full table | Per lead |

### Option A — Current (OK up to ~2k customers)

```
Pipedrive ──(32 paginated calls)──► filter by label ──► 1 NocoDB row per name/domain
                                                              │
Lead webhook ──(load 2000 rows)──────────────────────────────► loop all rows
```

**Limits:** NocoDB write storm on sync; suppression `limit` on qualify.

### Option B — Improved sync only (OK up to ~8k customers)

```
Pipedrive ──(32 calls or filter_id)──► bulk batch insert to suppression_entities (200/batch)
```

Qualification still loads many rows — increase limit + accept slower match.

### Option C — Recommended at scale (16k+ orgs)

Add one **snapshot row per account** (new NocoDB table or dedicated record):

```json
{
  "account_id": "rq1lQcYTToC9hlWD4vO94g",
  "customer_domains": ["acme.com", "movistar.es", "..."],
  "customer_names_normalized": ["acme corp", "movistar", "..."],
  "updated_at": "2026-07-08T12:00:00Z",
  "source": "pipedrive"
}
```

**Sync (hourly):**
```
Pipedrive 32 calls → build arrays in memory → 1 NocoDB PATCH (single snapshot row)
```

**Qualification (per lead):**
```
1 NocoDB GET snapshot (~500KB–2MB JSON)
1 NocoDB GET manual rules only (Movistar, Telefónica, recruiters — ~10–50 rows)
→ O(1) Set.has(domain) + Set.has(normalized_name) + small contains loop
```

| Metric | Current | Snapshot approach |
|--------|---------|-------------------|
| Pipedrive calls / sync | ~32 | ~32 (or 2–10 with filter) |
| NocoDB writes / sync | up to 32,000 | **1** |
| NocoDB reads / lead | 1 (up to 2000 rows) | **2** (small) |
| Match complexity | O(n) all suppressions | **O(1)** for customers + O(m) manual rules |
| Works at 16k customers | No (limit + timeout) | **Yes** |

Manual exclusions (`contains`: Movistar, Telefónica, recruiter) stay in `suppression_entities` as a small editable list.

---

## Volume reference table

Assumptions: 16,000 Pipedrive orgs, 8,000 labeled as Broker/Cliente Final, 50% have website.

| Stage | Metric | Current | With bulk sync | With snapshot (recommended) |
|-------|--------|---------|----------------|----------------------------|
| Pipedrive download | API calls | 32 | 32 (or 2–10 filtered) | 32 (or 2–10 filtered) |
| Sync to NocoDB | Writes | ~16,000 | ~80 batches | **1** |
| Sync duration | Estimate | 1–3 hours | 5–15 min | **< 1 min** |
| Qualify lead | NocoDB reads | 4 total | 4 total | 4 total |
| Qualify lead | Suppression data loaded | 2000 rows max | 2000 rows max | **1 snapshot + ~20 manual** |
| Qualify lead | Latency | 2–4 s | 2–4 s | **1–2 s** |

---

## What to configure today (without snapshot)

If you stay on the current model short-term:

1. **Create Pipedrive filter** (Broker + Cliente Final) → set `pipedrive_filter_id` (fewer Pipedrive pages)
2. **Do not sync persons**
3. **Tune sync:** `sync_max_writes_per_run`, `sync_batch_size`, hourly schedule
4. **Increase** qualification `Load Suppressions` limit if row count < 2000
5. **Monitor** `write_limit_reached` in sync output

---

## Implementation roadmap

| Phase | Change | Effort | Handles 16k? |
|-------|--------|--------|--------------|
| **Now** | Pipedrive filter + sync batch limits (done) | Low | Partial |
| **Next** | Bulk NocoDB insert in sync (batches of 200) | Medium | Sync yes, qualify partial |
| **Target** | `account_blocklist_snapshots` table + qualify by Set lookup | Medium | **Full** |

---

## Decision summary

| Question | Answer |
|----------|--------|
| ¿Una llamada Pipedrive por empresa? | **No.** ~32 llamadas paginadas para 16k orgs |
| ¿Descargar todo en JSON? | **Sí**, vía paginación; no hay un solo endpoint de export |
| ¿Sincronizar personas? | **No** para clientes existentes |
| ¿Saturará NocoDB? | Almacenamiento no; **escrituras masivas y lecturas por lead** sí |
| ¿Esperas al cualificar? | No hay espera artificial; el riesgo es **carga lenta + límite de filas** |
| ¿Mejor enfoque? | **Snapshot JSON por cuenta** (sync batch) + reglas manuales pequeñas (qualify real-time) |
