// ======================================================
// n8n Code Node - Normalize NextConvers Lead Payload
// Mode: Run Once for All Items
// Input: Webhook item with json.body
// Output: one normalized item per input item
// ======================================================

function cleanText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    value = value.map(v => cleanText(v)).filter(Boolean).join(', ');
  }
  return String(value)
    .replace(/\r?\n|\r/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(num) ? num : fallback;
}

function safeJsonParse(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_e) {
    return {};
  }
}

function getFirstName(fullName, fallback = '') {
  const name = cleanText(fullName);
  if (!name) return fallback;
  return name.split(' ')[0] || fallback;
}

function getLastName(fullName) {
  const name = cleanText(fullName);
  const parts = name.split(' ').filter(Boolean);
  if (parts.length <= 1) return '';
  return parts.slice(1).join(' ');
}

function normalizeLinkedinProfileUrl(url, publicIdentifier, profileId) {
  const cleanUrl = cleanText(url);
  if (cleanUrl.includes('/in/')) {
    return cleanUrl.split('?')[0].replace(/\/$/, '');
  }
  if (publicIdentifier) {
    return `https://www.linkedin.com/in/${publicIdentifier}`;
  }
  if (profileId) {
    return `https://www.linkedin.com/in/${profileId}`;
  }
  return cleanUrl;
}

function extractSkills(body, profileJson) {
  const skills = [];
  Object.keys(body || {}).forEach(key => {
    if (/^skills_\d+$/.test(key) && body[key]) {
      skills.push(cleanText(body[key]));
    }
  });
  if (Array.isArray(profileJson.topSkills)) {
    profileJson.topSkills.forEach(skill => {
      if (skill) skills.push(cleanText(skill));
    });
  }
  if (Array.isArray(profileJson.skills)) {
    profileJson.skills.forEach(skill => {
      if (skill?.name) skills.push(cleanText(skill.name));
    });
  }
  const parsedSkills = safeJsonParse(body.skills);
  if (Array.isArray(parsedSkills)) {
    parsedSkills.forEach(skill => {
      if (typeof skill === 'string') skills.push(cleanText(skill));
      else if (skill?.name) skills.push(cleanText(skill.name));
    });
  }
  return [...new Set(skills.filter(Boolean))];
}

function getCurrentPosition(profileJson, body) {
  if (Array.isArray(profileJson.currentPosition) && profileJson.currentPosition.length > 0) {
    return profileJson.currentPosition[0];
  }
  if (Array.isArray(profileJson.experience) && profileJson.experience.length > 0) {
    return profileJson.experience[0];
  }
  return {
    position: cleanText(body.headline),
    companyName: cleanText(body.company_name),
    companyLinkedinUrl: cleanText(body.company_linkedin_url),
    description: cleanText(body.current_company_description),
  };
}

function normalizeReactedPosts(posts) {
  const parsed = Array.isArray(posts) ? posts : safeJsonParse(posts);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(post => ({
    id: toNumber(post.id),
    url: cleanText(post.url),
    react_type: cleanText(post.react_type).toUpperCase(),
    reacted_at: cleanText(post.reacted_at),
  }));
}

return items.map(item => {
  let raw = item.json || {};
  try {
    const webhookItem = $('Webhook').first();
    if (webhookItem && webhookItem.json) {
      raw = webhookItem.json;
    }
  } catch (_e) {
    // Webhook node not in execution path; use current item
  }
  const body = raw.body || raw;

  const profileJson = safeJsonParse(body.reduced_profile_json_content);
  const currentPosition = getCurrentPosition(profileJson, body);

  const publicIdentifier = cleanText(profileJson.publicIdentifier || body.public_identifier);
  const profileId = cleanText(body.profile_id || profileJson.id);
  const fullName = cleanText(body.name || `${profileJson.firstName || ''} ${profileJson.lastName || ''}`);
  const firstName = cleanText(profileJson.firstName || body.first_name) || getFirstName(fullName);
  const lastName = cleanText(profileJson.lastName || body.last_name) || getLastName(fullName);

  const linkedinUrl = normalizeLinkedinProfileUrl(
    body.profile_url || body.linkedin_url || profileJson.linkedinUrl,
    publicIdentifier,
    profileId
  );

  const locationParsed = profileJson.location?.parsed || {};
  const locationText =
    cleanText(locationParsed.text) ||
    cleanText(profileJson.location?.linkedinText) ||
    cleanText(body.location);

  const companyName = cleanText(currentPosition.companyName || body.company_name);
  const companyLinkedinUrl = cleanText(currentPosition.companyLinkedinUrl || body.company_linkedin_url);

  const skills = extractSkills(body, profileJson);
  const topSkillsRaw = body.top_skills || profileJson.topSkills;
  const topSkillsParsed = Array.isArray(topSkillsRaw) ? topSkillsRaw : safeJsonParse(topSkillsRaw);
  const topSkills = Array.isArray(topSkillsParsed)
    ? topSkillsParsed.map(cleanText).filter(Boolean)
    : [];

  const reactedPosts = normalizeReactedPosts(body.reacted_posts);

  const normalized = {
    source_row_id: toNumber(body.id || body.source_row_id),
    profile_id: profileId,
    public_identifier: publicIdentifier,
    linkedin_url: linkedinUrl,
    profile_url: linkedinUrl,
    name: fullName,
    first_name: firstName,
    last_name: lastName,
    headline: cleanText(body.headline || profileJson.headline),
    country_code: cleanText(body.country_code || locationParsed.countryCode || profileJson.location?.countryCode).toUpperCase(),
    country: cleanText(body.country || locationParsed.country || locationParsed.countryFull),
    state: cleanText(body.state || locationParsed.state),
    city: cleanText(body.city || locationParsed.city),
    location: locationText,
    company_name: companyName,
    company_linkedin_url: companyLinkedinUrl,
    company_industry: cleanText(body.company_industry),
    current_position: cleanText(currentPosition.position || body.current_position),
    current_company_description: cleanText(
      currentPosition.description || body.current_company_description || body.positions_1_description
    ),
    summary: cleanText(body.summary || profileJson.about),
    quick_summary: cleanText(body.quick_summary || body.summary),
    connections_count: toNumber(body.connections_count || profileJson.connectionsCount),
    follower_count: toNumber(body.follower_count || profileJson.followerCount),
    skills_text: skills.join(', '),
    top_skills_text: topSkills.join(', '),
    react_type: cleanText(body.react_type).toUpperCase(),
    reacts_count: toNumber(body.reacts_count),
    reacted_posts_count: reactedPosts.length,
    post_url: cleanText(body.post_url),
    profile_score: toNumber(body.profile_score),
    profile_score_summary: cleanText(body.profile_score_summary),
    company_score: toNumber(body.company_score),
    company_score_summary: cleanText(body.company_score_Summary || body.company_score_summary),
    campaign_name: cleanText(body.campaign_name),
    account_id: cleanText(body.account_id),
    current_company_employee_count: toNumber(body.current_company_employeeCount || body.current_company_employee_count),
    current_company_headquarter_city: cleanText(body.current_company_headquarter_city),
    current_company_headquarter_country: cleanText(body.current_company_headquarter_country),
    current_company_headquarter_region: cleanText(body.current_company_headquarter_geographicArea || body.current_company_headquarter_region),
    email_enriched: cleanText(body.email_enriched || body.email),
    raw_payload: JSON.stringify(body),
  };

  return { json: normalized };
});
