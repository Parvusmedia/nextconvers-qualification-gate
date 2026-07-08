#!/usr/bin/env node
/**
 * Live integration: sample payload → NocoDB → decision → lead_decisions.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/deployment.generated.json'), 'utf8'));

const { parseConfigArray } = require('../n8n/code-nodes/lib/parse-config-array');
const { findMatchingPatterns, containsAnyInFields, normalizeForMatch } = require('../n8n/code-nodes/lib/text-match');
const { evaluateSuppressions } = require('../n8n/code-nodes/lib/suppression-match');

function loadToken() {
  const localEnv = path.join(ROOT, 'config/deployment.local.env');
  if (fs.existsSync(localEnv)) {
    for (const line of fs.readFileSync(localEnv, 'utf8').split('\n')) {
      if (line.startsWith('NOCODB_API_TOKEN=')) {
        return line.split('=').slice(1).join('=').trim();
      }
    }
  }
  if (process.env.NOCODB_API_TOKEN) return process.env.NOCODB_API_TOKEN.trim();
  const line = fs.readFileSync('/opt/apps/fly456bot/.env', 'utf8').split('\n').find(l => l.startsWith('NOCODB_API_TOKEN='));
  return line.split('=').slice(1).join('=').trim();
}

function request(method, urlPath, body) {
  const token = loadToken();
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const url = new URL(urlPath, dep.nocodb_base_url);
    const req = https.request(url, {
      method,
      headers: { 'xc-token': token, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let parsed; try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw }; }
        if (res.statusCode >= 400) reject(new Error(`${res.statusCode}: ${parsed.message || raw}`));
        else resolve(parsed);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function normalize(body) {
  const profileJson = typeof body.reduced_profile_json_content === 'string'
    ? JSON.parse(body.reduced_profile_json_content || '{}')
    : (body.reduced_profile_json_content || {});
  const pos = profileJson.currentPosition?.[0] || {};
  const linkedin = body.profile_url || profileJson.linkedinUrl || '';
  return {
    source_row_id: Number(body.id || 0),
    account_id: body.account_id || dep.qg_account_id,
    campaign_name: body.campaign_name,
    profile_id: body.profile_id || profileJson.id || '',
    public_identifier: profileJson.publicIdentifier || '',
    linkedin_url: linkedin,
    profile_url: linkedin,
    name: body.name || `${profileJson.firstName || ''} ${profileJson.lastName || ''}`.trim(),
    first_name: profileJson.firstName || '',
    last_name: profileJson.lastName || '',
    headline: body.headline || profileJson.headline || '',
    country_code: body.country_code || '',
    country: body.country || '',
    company_name: pos.companyName || body.company_name || '',
    company_linkedin_url: pos.companyLinkedinUrl || body.company_linkedin_url || '',
    company_industry: body.company_industry || '',
    current_position: pos.position || body.current_position || '',
    current_company_description: body.current_company_description || pos.description || '',
    summary: body.summary || '',
    profile_score: Number(body.profile_score || 0),
    company_score: Number(body.company_score || 0),
    current_company_employee_count: Number(body.current_company_employeeCount || 0),
    email_enriched: body.email_enriched || '',
    raw_payload: JSON.stringify(body),
  };
}

function parsePolicy(policy) {
  if (!policy) return null;
  const p = { ...policy };
  for (const k of ['allowed_countries','excluded_countries','allowed_industries','excluded_industries','target_roles','review_roles','excluded_roles','target_departments','excluded_departments','target_company_types','review_company_types','excluded_company_types','target_keywords','review_keywords','excluded_keywords']) {
    p[k] = parseConfigArray(p[k]);
  }
  p.review_if_profile_score_high_company_score_low = p.review_if_profile_score_high_company_score_low === true || p.review_if_profile_score_high_company_score_low === 1;
  p.require_no_suppression_match = p.require_no_suppression_match === true || p.require_no_suppression_match === 1;
  return p;
}

function evaluateHardRules(lead, rawPolicy, suppressions) {
  const ctx = { suppression_matches: [], risk_flags: [], positive_signals: [], reject_reasons: [], review_reasons: [], hard_reject: false, suppression_reject: false, force_review: false, policy_found: false };
  const policy = parsePolicy(rawPolicy);
  if (!policy) { ctx.force_review = true; ctx.review_reasons.push('No active policy found'); return ctx; }
  ctx.policy_found = true;
  ctx.suppression_matches = evaluateSuppressions(lead, suppressions);
  if (ctx.suppression_matches.some(m => m.severity === 'reject')) {
    ctx.suppression_reject = true;
    ctx.reject_reasons.push(`Suppression match: ${ctx.suppression_matches.filter(m => m.severity === 'reject').map(m => m.reason || m.entity_value).join('; ')}`);
    return ctx;
  }
  const roleFields = [lead.headline, lead.current_position];
  const companyFields = [lead.company_industry, lead.current_company_description, lead.company_name, lead.summary];
  if (policy.min_profile_score > 0 && lead.profile_score < policy.min_profile_score) { ctx.hard_reject = true; ctx.reject_reasons.push(`Profile score ${lead.profile_score} below minimum ${policy.min_profile_score}`); }
  const targetRoleHits = findMatchingPatterns(roleFields, policy.target_roles);
  if (targetRoleHits.length) ctx.positive_signals.push(`Target role match: ${targetRoleHits.join(', ')}`);
  const excludedRoleHits = findMatchingPatterns(roleFields, policy.excluded_roles);
  if (excludedRoleHits.length) { ctx.hard_reject = true; ctx.reject_reasons.push(`Excluded role match: ${excludedRoleHits.join(', ')}`); }
  const excludedKeywordHits = findMatchingPatterns([...roleFields, ...companyFields], policy.excluded_keywords);
  if (excludedKeywordHits.length) { ctx.hard_reject = true; ctx.reject_reasons.push(`Excluded keyword match: ${excludedKeywordHits.join(', ')}`); }
  if (policy.review_if_profile_score_high_company_score_low && lead.profile_score >= (policy.ready_for_crm_profile_score || 4) && lead.company_score < (policy.ready_for_crm_company_score || 3)) {
    ctx.review_reasons.push(`High profile score (${lead.profile_score}) with low company score (${lead.company_score})`);
  }
  return ctx;
}

function buildDecision(lead, policy, evaluation) {
  const ev = evaluation;
  const crmP = Number(policy.ready_for_crm_profile_score) || 4;
  const crmC = Number(policy.ready_for_crm_company_score) || 3;
  const autoReady = Number(policy.auto_ready_threshold) || 1;
  let qualification_status = 'READY_FOR_REVIEW';
  let decision_reason = '';
  let crm_sync_status = 'review';
  if (ev.suppression_reject) { qualification_status = 'SUPPRESSED'; decision_reason = ev.reject_reasons.join('; '); crm_sync_status = 'blocked'; }
  else if (ev.hard_reject) { qualification_status = 'REJECTED'; decision_reason = ev.reject_reasons.join('; '); crm_sync_status = 'blocked'; }
  else if (lead.profile_score >= crmP && lead.company_score >= crmC && ev.positive_signals.length >= autoReady && !ev.review_reasons.length && !ev.risk_flags.length) {
    qualification_status = 'READY_FOR_CRM'; decision_reason = `Meets CRM thresholds with ${ev.positive_signals.length} positive signal(s)`; crm_sync_status = 'pending';
  } else {
    decision_reason = ev.review_reasons.join('; ') || 'Did not meet auto-ready criteria';
  }
  const webhook_response = { source_row_id: String(lead.source_row_id), linkedin_url: lead.linkedin_url, campaign_name: lead.campaign_name, qualification_status, qualification_confidence: 80, decision_reason, risk_flags: ev.risk_flags, positive_signals: ev.positive_signals, crm_sync_status };
  const lead_decision_row = {
    account_id: lead.account_id, campaign_name: lead.campaign_name, product_name: policy.product_name || '', motion_type: policy.motion_type || '',
    source_row_id: lead.source_row_id, profile_id: lead.profile_id, linkedin_url: lead.linkedin_url, name: lead.name, headline: lead.headline,
    company_name: lead.company_name, profile_score: lead.profile_score, company_score: lead.company_score,
    qualification_status, qualification_confidence: 80, decision_reason,
    suppression_matches: JSON.stringify(ev.suppression_matches), risk_flags: JSON.stringify(ev.risk_flags), positive_signals: JSON.stringify(ev.positive_signals),
    crm_sync_status, raw_payload: lead.raw_payload,
  };
  return { webhook_response, lead_decision_row };
}

async function main() {
  const body = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/sample-payloads/nextconvers-sample-payload.json'), 'utf8'));
  body.account_id = dep.qg_account_id;
  const lead = normalize(body);

  const policyResp = await request('GET', `/api/v2/tables/${dep.nocodb_campaign_policies_table_id}/records?where=(account_id,eq,${lead.account_id})~and(campaign_name,eq,${encodeURIComponent(lead.campaign_name)})~and(active,eq,true)&limit=1`);
  const policy = (policyResp.list || [])[0];
  if (!policy) throw new Error('No policy found for ' + lead.campaign_name);

  const supResp = await request('GET', `/api/v2/tables/${dep.nocodb_suppression_entities_table_id}/records?where=(account_id,eq,${lead.account_id})~and(active,eq,true)&limit=100`);
  const suppressions = (supResp.list || []).filter(s => !s.campaign_name || s.campaign_name === lead.campaign_name);

  const evaluation = evaluateHardRules(lead, policy, suppressions);
  const decision = buildDecision(lead, policy, evaluation);

  console.log('✓ Decision:', decision.webhook_response.qualification_status);
  console.log('  Reason:', decision.webhook_response.decision_reason);

  const saved = await request('POST', `/api/v2/tables/${dep.nocodb_lead_decisions_table_id}/records`, decision.lead_decision_row);
  console.log('✓ Saved lead_decision Id:', saved.Id || saved.id);
  console.log('\nWebhook response:', JSON.stringify(decision.webhook_response, null, 2));
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
