// ======================================================
// n8n Code Node - Build Decision Output
// Mode: Run Once for All Items
// Input: lead, policy, evaluation context
// Output: final decision + webhook response + NocoDB row
// ======================================================

function computeConfidence(lead, evaluation, status) {
  let score = 50;
  score += Math.min(lead.profile_score || 0, 5) * 5;
  score += Math.min(lead.company_score || 0, 5) * 3;
  score += (evaluation.positive_signals || []).length * 5;
  score -= (evaluation.risk_flags || []).length * 8;
  score -= (evaluation.review_reasons || []).length * 4;

  if (status === 'READY_FOR_CRM') score = Math.max(score, 75);
  if (status === 'REJECTED' || status === 'SUPPRESSED') score = Math.min(score, 30);
  if (status === 'READY_FOR_REVIEW') score = Math.min(Math.max(score, 40), 70);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildDecision(lead, policy, evaluation) {
  const ev = evaluation || {};
  const parsedPolicy = policy || {};

  let qualification_status = 'READY_FOR_REVIEW';
  let reject_reason = '';
  let review_reason = '';
  let decision_reason = '';
  let crm_sync_status = 'review';

  const autoReadyThreshold = Number(parsedPolicy.auto_ready_threshold) || 1;
  const reviewThreshold = Number(parsedPolicy.review_threshold) || 1;
  const crmProfileScore = Number(parsedPolicy.ready_for_crm_profile_score) || 4;
  const crmCompanyScore = Number(parsedPolicy.ready_for_crm_company_score) || 3;

  const positiveCount = (ev.positive_signals || []).length;
  const riskCount = (ev.risk_flags || []).length;
  const hasReject = ev.hard_reject || ev.suppression_reject || (ev.reject_reasons || []).length > 0;

  if (ev.suppression_reject) {
    qualification_status = 'SUPPRESSED';
    reject_reason = (ev.reject_reasons || []).join('; ') || 'Suppression match';
    decision_reason = reject_reason;
    crm_sync_status = 'blocked';
  } else if (hasReject) {
    qualification_status = 'REJECTED';
    reject_reason = (ev.reject_reasons || []).join('; ');
    decision_reason = reject_reason;
    crm_sync_status = 'blocked';
  } else if (!ev.policy_found || ev.force_review) {
    qualification_status = 'READY_FOR_REVIEW';
    review_reason = (ev.review_reasons || []).join('; ') || 'No active policy found';
    decision_reason = review_reason;
    crm_sync_status = 'review';
  } else if (
    lead.profile_score >= crmProfileScore &&
    lead.company_score >= crmCompanyScore &&
    positiveCount >= autoReadyThreshold &&
    riskCount === 0 &&
    (ev.review_reasons || []).length === 0
  ) {
    qualification_status = 'READY_FOR_CRM';
    decision_reason = `Meets CRM thresholds (profile ${lead.profile_score}, company ${lead.company_score}) with ${positiveCount} positive signal(s)`;
    crm_sync_status = 'pending';
  } else if (
    (ev.review_reasons || []).length > 0 ||
    riskCount >= reviewThreshold ||
    positiveCount < autoReadyThreshold
  ) {
    qualification_status = 'READY_FOR_REVIEW';
    const parts = [];
    if ((ev.review_reasons || []).length) parts.push(...ev.review_reasons);
    if (riskCount >= reviewThreshold) parts.push(`${riskCount} risk flag(s)`);
    if (positiveCount < autoReadyThreshold) parts.push(`Insufficient positive signals (${positiveCount}/${autoReadyThreshold})`);
    review_reason = parts.join('; ');
    decision_reason = review_reason || 'Ambiguous — manual review recommended';
    crm_sync_status = 'review';
  } else {
    qualification_status = 'READY_FOR_REVIEW';
    review_reason = 'Did not meet auto-ready criteria';
    decision_reason = review_reason;
    crm_sync_status = 'review';
  }

  const qualification_confidence = computeConfidence(lead, ev, qualification_status);

  const webhook_response = {
    source_row_id: String(lead.source_row_id || ''),
    linkedin_url: lead.linkedin_url || '',
    campaign_name: lead.campaign_name || '',
    qualification_status,
    qualification_confidence,
    decision_reason,
    risk_flags: ev.risk_flags || [],
    positive_signals: ev.positive_signals || [],
    crm_sync_status,
  };

  const lead_decision_row = {
    account_id: lead.account_id || '',
    campaign_name: lead.campaign_name || '',
    product_name: parsedPolicy.product_name || '',
    motion_type: parsedPolicy.motion_type || '',
    source_row_id: lead.source_row_id || null,
    profile_id: lead.profile_id || '',
    public_identifier: lead.public_identifier || '',
    linkedin_url: lead.linkedin_url || '',
    profile_url: lead.profile_url || '',
    name: lead.name || '',
    first_name: lead.first_name || '',
    last_name: lead.last_name || '',
    headline: lead.headline || '',
    country_code: lead.country_code || '',
    country: lead.country || '',
    state: lead.state || '',
    city: lead.city || '',
    location: lead.location || '',
    company_name: lead.company_name || '',
    company_linkedin_url: lead.company_linkedin_url || '',
    company_industry: lead.company_industry || '',
    current_position: lead.current_position || '',
    current_company_description: lead.current_company_description || '',
    summary: lead.summary || '',
    quick_summary: lead.quick_summary || '',
    connections_count: lead.connections_count || null,
    follower_count: lead.follower_count || null,
    skills_text: lead.skills_text || '',
    top_skills_text: lead.top_skills_text || '',
    react_type: lead.react_type || '',
    reacts_count: lead.reacts_count || null,
    reacted_posts_count: lead.reacted_posts_count || null,
    post_url: lead.post_url || '',
    profile_score: lead.profile_score || null,
    profile_score_summary: lead.profile_score_summary || '',
    company_score: lead.company_score || null,
    company_score_summary: lead.company_score_summary || '',
    current_company_employee_count: lead.current_company_employee_count || null,
    current_company_headquarter_city: lead.current_company_headquarter_city || '',
    current_company_headquarter_country: lead.current_company_headquarter_country || '',
    current_company_headquarter_region: lead.current_company_headquarter_region || '',
    email_enriched: lead.email_enriched || '',
    qualification_status,
    qualification_confidence,
    decision_reason,
    reject_reason,
    review_reason,
    suppression_matches: JSON.stringify(ev.suppression_matches || []),
    risk_flags: JSON.stringify(ev.risk_flags || []),
    positive_signals: JSON.stringify(ev.positive_signals || []),
    crm_sync_status,
    raw_payload: lead.raw_payload || '',
  };

  return {
    ...lead_decision_row,
    webhook_response,
    evaluation: ev,
  };
}

return items.map(item => {
  const data = item.json || {};
  const lead = data.lead || {};
  const policy = data.policy || {};
  const evaluation = data.evaluation || {};

  const decision = buildDecision(lead, policy, evaluation);

  return {
    json: {
      lead,
      policy,
      evaluation,
      existing_decision_id: data.existing_decision_id || null,
      ...decision,
    },
  };
});
