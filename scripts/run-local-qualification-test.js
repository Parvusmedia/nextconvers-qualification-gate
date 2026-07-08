#!/usr/bin/env node
/**
 * Local smoke test for qualification logic (no n8n / NocoDB required).
 * Usage: node scripts/run-local-qualification-test.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// --- Inline minimal evaluator (same logic as evaluate-hard-rules.js) ---
const { parseConfigArray } = require('../n8n/code-nodes/lib/parse-config-array');
const { findMatchingPatterns, containsAnyInFields, normalizeForMatch } = require('../n8n/code-nodes/lib/text-match');
const { evaluateSuppressions } = require('../n8n/code-nodes/lib/suppression-match');
const { evaluateBlocklistSnapshot } = require('../n8n/code-nodes/lib/blocklist-snapshot');

function parsePolicy(policy) {
  if (!policy) return null;
  return {
    ...policy,
    allowed_countries: parseConfigArray(policy.allowed_countries),
    excluded_countries: parseConfigArray(policy.excluded_countries),
    allowed_industries: parseConfigArray(policy.allowed_industries),
    excluded_industries: parseConfigArray(policy.excluded_industries),
    target_roles: parseConfigArray(policy.target_roles),
    review_roles: parseConfigArray(policy.review_roles),
    excluded_roles: parseConfigArray(policy.excluded_roles),
    target_departments: parseConfigArray(policy.target_departments),
    excluded_departments: parseConfigArray(policy.excluded_departments),
    target_company_types: parseConfigArray(policy.target_company_types),
    review_company_types: parseConfigArray(policy.review_company_types),
    excluded_company_types: parseConfigArray(policy.excluded_company_types),
    target_keywords: parseConfigArray(policy.target_keywords),
    review_keywords: parseConfigArray(policy.review_keywords),
    excluded_keywords: parseConfigArray(policy.excluded_keywords),
    min_profile_score: Number(policy.min_profile_score) || 0,
    min_company_score: Number(policy.min_company_score) || 0,
    min_company_size: Number(policy.min_company_size) || 0,
    max_company_size: Number(policy.max_company_size) || 0,
    ready_for_crm_profile_score: Number(policy.ready_for_crm_profile_score) || 4,
    ready_for_crm_company_score: Number(policy.ready_for_crm_company_score) || 3,
    auto_ready_threshold: Number(policy.auto_ready_threshold) || 1,
    review_threshold: Number(policy.review_threshold) || 1,
    review_if_profile_score_high_company_score_low:
      policy.review_if_profile_score_high_company_score_low === true,
    require_no_suppression_match: policy.require_no_suppression_match === true,
  };
}

function evaluateHardRules(lead, rawPolicy, suppressions, blocklistSnapshot) {
  const ctx = {
    suppression_matches: [],
    risk_flags: [],
    positive_signals: [],
    reject_reasons: [],
    review_reasons: [],
    hard_reject: false,
    suppression_reject: false,
    force_review: false,
    policy_found: false,
  };
  const policy = parsePolicy(rawPolicy);
  if (!policy) {
    ctx.force_review = true;
    ctx.review_reasons.push('No active policy found');
    return ctx;
  }
  ctx.policy_found = true;

  ctx.suppression_matches = [
    ...evaluateBlocklistSnapshot(lead, blocklistSnapshot),
    ...evaluateSuppressions(lead, suppressions),
  ];
  const rejectMatches = ctx.suppression_matches.filter(m => m.severity === 'reject');
  const reviewMatches = ctx.suppression_matches.filter(m => m.severity === 'review');
  if (rejectMatches.length) {
    ctx.suppression_reject = true;
    ctx.reject_reasons.push(`Suppression match: ${rejectMatches.map(m => m.reason || m.entity_value).join('; ')}`);
    return ctx;
  }
  reviewMatches.forEach(m => ctx.risk_flags.push(`Suppression review: ${m.reason || m.entity_value}`));

  const roleFields = [lead.headline, lead.current_position];
  const companyFields = [lead.company_industry, lead.current_company_description, lead.company_name, lead.summary];

  if (policy.min_profile_score > 0 && lead.profile_score < policy.min_profile_score) {
    ctx.hard_reject = true;
    ctx.reject_reasons.push(`Profile score ${lead.profile_score} below minimum ${policy.min_profile_score}`);
  }
  if (policy.min_company_score > 0 && lead.company_score < policy.min_company_score) {
    if (policy.review_if_profile_score_high_company_score_low && lead.profile_score >= policy.ready_for_crm_profile_score) {
      ctx.review_reasons.push(`Company score ${lead.company_score} below minimum ${policy.min_company_score} but profile score is high`);
    } else {
      ctx.hard_reject = true;
      ctx.reject_reasons.push(`Company score ${lead.company_score} below minimum ${policy.min_company_score}`);
    }
  }
  if (policy.review_if_profile_score_high_company_score_low && lead.profile_score >= policy.ready_for_crm_profile_score && lead.company_score < policy.ready_for_crm_company_score) {
    ctx.review_reasons.push(`High profile score (${lead.profile_score}) with low company score (${lead.company_score})`);
  }
  if (policy.min_company_size > 0 && lead.current_company_employee_count > 0 && lead.current_company_employee_count < policy.min_company_size) {
    ctx.hard_reject = true;
    ctx.reject_reasons.push(`Company size ${lead.current_company_employee_count} below minimum ${policy.min_company_size}`);
  }

  const country = normalizeForMatch(lead.country_code || lead.country);
  if (policy.excluded_countries.length && policy.excluded_countries.some(c => normalizeForMatch(c) === country || normalizeForMatch(c) === normalizeForMatch(lead.country))) {
    ctx.hard_reject = true;
    ctx.reject_reasons.push(`Country ${lead.country || lead.country_code} is excluded`);
  }
  if (policy.allowed_countries.length) {
    const allowed = policy.allowed_countries.some(c => normalizeForMatch(c) === country || normalizeForMatch(c) === normalizeForMatch(lead.country));
    if (!allowed) ctx.review_reasons.push(`Country ${lead.country || lead.country_code} not in allowed list`);
  }
  if (policy.excluded_industries.length && containsAnyInFields([lead.company_industry], policy.excluded_industries)) {
    ctx.hard_reject = true;
    ctx.reject_reasons.push(`Industry ${lead.company_industry} is excluded`);
  }

  const excludedRoleHits = findMatchingPatterns(roleFields, policy.excluded_roles);
  if (excludedRoleHits.length) { ctx.hard_reject = true; ctx.reject_reasons.push(`Excluded role match: ${excludedRoleHits.join(', ')}`); }
  const excludedKeywordHits = findMatchingPatterns([...roleFields, ...companyFields], policy.excluded_keywords);
  if (excludedKeywordHits.length) { ctx.hard_reject = true; ctx.reject_reasons.push(`Excluded keyword match: ${excludedKeywordHits.join(', ')}`); }
  const reviewRoleHits = findMatchingPatterns(roleFields, policy.review_roles);
  if (reviewRoleHits.length) ctx.review_reasons.push(`Review role match: ${reviewRoleHits.join(', ')}`);
  const targetRoleHits = findMatchingPatterns(roleFields, policy.target_roles);
  if (targetRoleHits.length) ctx.positive_signals.push(`Target role match: ${targetRoleHits.join(', ')}`);
  const targetKeywordHits = findMatchingPatterns([...roleFields, ...companyFields], policy.target_keywords);
  if (targetKeywordHits.length) ctx.positive_signals.push(`Target keyword match: ${targetKeywordHits.join(', ')}`);
  const excludedCompanyTypeHits = findMatchingPatterns(companyFields, policy.excluded_company_types);
  if (excludedCompanyTypeHits.length) { ctx.hard_reject = true; ctx.reject_reasons.push(`Excluded company type: ${excludedCompanyTypeHits.join(', ')}`); }
  const targetCompanyTypeHits = findMatchingPatterns(companyFields, policy.target_company_types);
  if (targetCompanyTypeHits.length) ctx.positive_signals.push(`Target company type: ${targetCompanyTypeHits.join(', ')}`);

  if (policy.require_no_suppression_match && ctx.suppression_matches.length) {
    ctx.risk_flags.push('Suppression match present (require_no_suppression_match)');
  }
  return ctx;
}

function buildDecision(lead, policy, evaluation) {
  const ev = evaluation || {};
  const parsedPolicy = policy || {};
  let qualification_status = 'READY_FOR_REVIEW';
  let reject_reason = '';
  let review_reason = '';
  let decision_reason = '';
  const autoReadyThreshold = Number(parsedPolicy.auto_ready_threshold) || 1;
  const reviewThreshold = Number(parsedPolicy.review_threshold) || 1;
  const crmProfileScore = Number(parsedPolicy.ready_for_crm_profile_score) || 4;
  const crmCompanyScore = Number(parsedPolicy.ready_for_crm_company_score) || 3;
  const positiveCount = (ev.positive_signals || []).length;
  const riskCount = (ev.risk_flags || []).length;
  const hasReject = ev.hard_reject || ev.suppression_reject || (ev.reject_reasons || []).length > 0;

  if (ev.suppression_reject) {
    qualification_status = 'SUPPRESSED';
    reject_reason = (ev.reject_reasons || []).join('; ');
    decision_reason = reject_reason;
  } else if (hasReject) {
    qualification_status = 'REJECTED';
    reject_reason = (ev.reject_reasons || []).join('; ');
    decision_reason = reject_reason;
  } else if (!ev.policy_found || ev.force_review) {
    qualification_status = 'READY_FOR_REVIEW';
    review_reason = (ev.review_reasons || []).join('; ') || 'No active policy found';
    decision_reason = review_reason;
  } else if (lead.profile_score >= crmProfileScore && lead.company_score >= crmCompanyScore && positiveCount >= autoReadyThreshold && riskCount === 0 && !(ev.review_reasons || []).length) {
    qualification_status = 'READY_FOR_CRM';
    decision_reason = `Meets CRM thresholds with ${positiveCount} positive signal(s)`;
  } else {
    qualification_status = 'READY_FOR_REVIEW';
    const parts = [...(ev.review_reasons || [])];
    if (riskCount >= reviewThreshold) parts.push(`${riskCount} risk flag(s)`);
    if (positiveCount < autoReadyThreshold) parts.push(`Insufficient positive signals (${positiveCount}/${autoReadyThreshold})`);
    review_reason = parts.join('; ') || 'Did not meet auto-ready criteria';
    decision_reason = review_reason;
  }
  return { qualification_status, decision_reason, reject_reason, review_reason };
}

// --- Scenarios ---
const finalClientPolicy = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/examples/telefonica-cyberseguro-final-client.json'), 'utf8'));
const brokersPolicy = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/examples/telefonica-cyberseguro-brokers.json'), 'utf8'));
const sampleLead = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/sample-payloads/nextconvers-sample-payload.json'), 'utf8'));

const baseLead = {
  account_id: 'test-account',
  campaign_name: 'Cyberseguro - Cliente Final',
  source_row_id: 987654,
  linkedin_url: 'https://www.linkedin.com/in/carlos-martinez-ciso',
  headline: sampleLead.headline,
  current_position: sampleLead.current_position,
  company_name: sampleLead.company_name,
  company_industry: sampleLead.company_industry,
  current_company_description: sampleLead.current_company_description,
  current_company_employee_count: sampleLead.current_company_employeeCount,
  country_code: sampleLead.country_code,
  country: sampleLead.country,
  profile_score: sampleLead.profile_score,
  company_score: sampleLead.company_score,
  summary: sampleLead.summary,
};

const scenarios = [
  { name: 'CISO final client → READY_FOR_CRM', lead: { ...baseLead }, policy: finalClientPolicy, suppressions: [], expected: 'READY_FOR_CRM' },
  { name: 'Broker on final client policy → REJECTED', lead: { ...baseLead, headline: 'Insurance Broker', current_position: 'Insurance Broker' }, policy: finalClientPolicy, suppressions: [], expected: 'REJECTED' },
  { name: 'Broker on brokers policy → READY_FOR_CRM', lead: { ...baseLead, campaign_name: 'Cyberseguro - Brokers', headline: 'Insurance Broker', current_position: 'Insurance Broker', company_industry: 'Insurance', current_company_description: 'insurance brokerage for SME clients', company_score: 3 }, policy: brokersPolicy, suppressions: [], expected: 'READY_FOR_CRM' },
  { name: 'Recruiter → REJECTED', lead: { ...baseLead, headline: 'Talent Acquisition Specialist', current_position: 'Senior Recruiter' }, policy: finalClientPolicy, suppressions: [], expected: 'REJECTED' },
  { name: 'Movistar suppression → SUPPRESSED', lead: { ...baseLead, company_name: 'Movistar Empresas', headline: 'IT Manager' }, policy: finalClientPolicy, suppressions: [{ entity_type: 'company_name', entity_value: 'Movistar', match_type: 'contains', reason: 'existing_customer', severity: 'reject', active: true }], expected: 'SUPPRESSED' },
  { name: 'Pipedrive customer via snapshot → SUPPRESSED', lead: { ...baseLead, company_name: 'Example Retail Holdings SA', headline: 'IT Manager' }, policy: finalClientPolicy, suppressions: [], blocklist_snapshot: { customer_names_json: '["example retail holdings"]', customer_domains_json: '[]', customer_linkedin_urls_json: '[]' }, expected: 'SUPPRESSED' },
  { name: 'Telefonica de España via snapshot → SUPPRESSED', lead: { ...baseLead, company_name: 'Telefonica de España', headline: 'IT Manager', company_industry: 'Telecommunications' }, policy: finalClientPolicy, suppressions: [], blocklist_snapshot: { customer_names_json: '["telefonica de espana"]', customer_domains_json: '[]', customer_linkedin_urls_json: '[]' }, expected: 'SUPPRESSED' },
  { name: 'Telefónica manual contains → SUPPRESSED', lead: { ...baseLead, company_name: 'Telefonica de España', headline: 'IT Manager', company_industry: 'Telecommunications' }, policy: finalClientPolicy, suppressions: [{ entity_type: 'company_name', entity_value: 'Telefónica', match_type: 'contains', reason: 'existing_customer', severity: 'reject', active: true }], expected: 'SUPPRESSED' },
  { name: 'High profile low company → READY_FOR_REVIEW', lead: { ...baseLead, profile_score: 5, company_score: 1 }, policy: finalClientPolicy, suppressions: [], expected: 'READY_FOR_REVIEW' },
  { name: 'No policy → READY_FOR_REVIEW', lead: { ...baseLead, campaign_name: 'Unknown' }, policy: null, suppressions: [], expected: 'READY_FOR_REVIEW' },
];

let passed = 0;
let failed = 0;

console.log('NextConvers Qualification Gate — local smoke tests\n');

for (const s of scenarios) {
  const evaluation = evaluateHardRules(s.lead, s.policy, s.suppressions, s.blocklist_snapshot || null);
  const decision = buildDecision(s.lead, s.policy, evaluation);
  const ok = decision.qualification_status === s.expected;
  if (ok) { passed++; console.log(`✓ ${s.name}`); }
  else {
    failed++;
    console.log(`✗ ${s.name}`);
    console.log(`  expected: ${s.expected}, got: ${decision.qualification_status}`);
    console.log(`  reason: ${decision.decision_reason}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
