'use strict';

/**
 * Persona Brain authoritative validator.
 *
 * Validation is intentionally schema-aware but permissive for optional fields:
 * only present values are checked. It returns machine-readable checks for the
 * workbench while preserving the historic { valid, errors } contract.
 */

const DISCLOSURE_RULES = ['disclosure_complete', 'disclosure_partial', 'disclosure_none'];
const REQUIRED_STAGES = ['new', 'familiar', 'warming', 'trust_building', 'deep_trust'];

function clean(value) { return String(value == null ? '' : value).trim(); }
function check(rule, field, pass, message, severity = 'error') { return { rule, field, pass: Boolean(pass), message, severity }; }
function zodiacForDate(dateText) {
  const match = clean(dateText).match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const month = Number(match[1]);
  const day = Number(match[2]);
  const boundaries = {
    1:[20,'Capricorn','Aquarius'],2:[19,'Aquarius','Pisces'],3:[21,'Pisces','Aries'],4:[20,'Aries','Taurus'],
    5:[21,'Taurus','Gemini'],6:[21,'Gemini','Cancer'],7:[23,'Cancer','Leo'],8:[23,'Leo','Virgo'],
    9:[23,'Virgo','Libra'],10:[23,'Libra','Scorpio'],11:[22,'Scorpio','Sagittarius'],12:[22,'Sagittarius','Capricorn']
  };
  const row = boundaries[month];
  return row ? (day >= row[0] ? row[2] : row[1]) : '';
}
function isValidDate(value) { const date = new Date(value); return !Number.isNaN(date.getTime()); }

function collectChecks(authoritative = {}) {
  const checks = [];
  const profile = authoritative.personaProfile || {};
  if (authoritative.personaProfile != null) {
    checks.push(check('PERSONA_PROFILE_TYPE', 'personaProfile', typeof profile === 'object' && !Array.isArray(profile), '动态人设必须是对象。'));
    for (const field of ['name', 'city', 'occupation', 'lifeStatus']) {
      if (profile[field] != null) checks.push(check('PERSONA_PROFILE_STRING', `personaProfile.${field}`, typeof profile[field] === 'string', `${field} 必须是字符串。`));
    }
    if (profile.age != null) checks.push(check('PERSONA_PROFILE_AGE', 'personaProfile.age', Number.isFinite(Number(profile.age)) && Number(profile.age) >= 0 && Number(profile.age) <= 150, '动态人设年龄必须是 0–150 的数字。'));
    for (const field of ['experiences', 'personality', 'relationshipViews', 'interests', 'expressionHabits', 'replyStylePreferences', 'forbiddenExpressions']) {
      if (profile[field] != null) checks.push(check('PERSONA_PROFILE_LIST', `personaProfile.${field}`, Array.isArray(profile[field]), `${field} 必须是数组。`));
    }
    if (profile.specialRelationshipSettings != null) checks.push(check(
      'PERSONA_PROFILE_SPECIAL_RELATIONSHIPS',
      'personaProfile.specialRelationshipSettings',
      (typeof profile.specialRelationshipSettings === 'object' && !Array.isArray(profile.specialRelationshipSettings)) || Array.isArray(profile.specialRelationshipSettings),
      'specialRelationshipSettings 必须是对象或数组。'
    ));
  }

  const replyStyle = authoritative.replyStylePolicy || {};
  if (authoritative.replyStylePolicy != null) {
    checks.push(check('REPLY_STYLE_TYPE', 'replyStylePolicy', typeof replyStyle === 'object' && !Array.isArray(replyStyle), '回复风格策略必须是对象。'));
    if (replyStyle.intensity != null) checks.push(check('REPLY_STYLE_INTENSITY', 'replyStylePolicy.intensity', ['natural', 'obvious', 'strong'].includes(clean(replyStyle.intensity)), '表达强度必须是 natural、obvious 或 strong。'));
    if (replyStyle.directions != null) {
      const directions = replyStyle.directions;
      checks.push(check('REPLY_STYLE_DIRECTIONS_TYPE', 'replyStylePolicy.directions', typeof directions === 'object' && !Array.isArray(directions), '风格权重必须是对象。'));
      if (typeof directions === 'object' && !Array.isArray(directions)) {
        for (const [key, value] of Object.entries(directions)) checks.push(check('REPLY_STYLE_WEIGHT', `replyStylePolicy.directions.${key}`, Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100, `${key} 权重必须在 0–100。`));
      }
    }
  }
  const core = authoritative.coreIdentity || {};
  const birthDate = clean(core.birthDate);
  if (birthDate || core.zodiac) {
    checks.push(check('BIRTH_DATE_FORMAT', 'coreIdentity.birthDate', /^\d{4}-\d{2}-\d{2}$/.test(birthDate), '出生日期必须使用 YYYY-MM-DD。'));
    const expected = zodiacForDate(birthDate);
    checks.push(check('ZODIAC_MATCH', 'coreIdentity.zodiac', !expected || clean(core.zodiac) === expected, `星座应与出生日期一致：${expected || '未知'}。`));
  }

  const age = authoritative.age ?? authoritative.customer?.age;
  if (age != null) {
    if (typeof age !== 'number' || !Number.isFinite(age)) checks.push(check('AGE_TYPE', 'age', false, '年龄必须是有限数字。'));
    else checks.push(check('AGE_RANGE', 'age', age >= 0 && age <= 150, '年龄必须是 0–150 的有限数字。'));
  }

  for (const [field, value] of [
    ['relationship.startDate', authoritative.relationship?.startDate],
    ['customer.firstContactAt', authoritative.customer?.firstContactAt],
    ['customer.birthday', authoritative.customer?.birthday]
  ]) {
    if (value != null) checks.push(check('DATE_INVALID', field, isValidDate(value), `${field} 必须是有效日期。`));
  }

  const residence = core.residence || authoritative.location || authoritative.customer?.location;
  if (residence != null) {
    checks.push(check('LOCATION_TYPE', 'coreIdentity.residence', typeof residence === 'object' && !Array.isArray(residence), '所在地必须是对象。'));
    if (typeof residence === 'object' && !Array.isArray(residence)) {
      for (const field of ['city', 'country', 'region', 'timezone']) {
        const value = residence[field];
        if (value != null) checks.push(check('LOCATION_FIELD_TYPE', `coreIdentity.residence.${field}`, typeof value === 'string', `${field} 必须是字符串。`));
      }
      if (residence.sinceYear != null) {
        const year = Number(residence.sinceYear);
        checks.push(check('RESIDENCE_SINCE_YEAR', 'coreIdentity.residence.sinceYear', Number.isInteger(year) && year >= 1900 && year <= new Date().getUTCFullYear(), '迁居年份必须合理。'));
      }
    }
  }

  const residenceSinceYear = Number(core.residence?.sinceYear || 0);
  if (residenceSinceYear > 0) {
    const timelineRows = [
      ...(Array.isArray(authoritative.educationAndCareer?.timeline) ? authoritative.educationAndCareer.timeline : []),
      ...(Array.isArray(authoritative.educationAndCareer?.education) ? authoritative.educationAndCareer.education : [])
    ];
    const preMoveBerlinRows = timelineRows.filter(row => /berlin/i.test(clean(row?.place)) && Number(row?.from || 0) < residenceSinceYear);
    checks.push(check(
      'NO_PRE_MOVE_BERLIN_CAREER',
      'educationAndCareer.timeline',
      preMoveBerlinRows.length === 0,
      preMoveBerlinRows.length ? `发现迁居前的柏林记录：${preMoveBerlinRows.map(row => `${row.from || ''}-${row.to || 'now'} ${row.role || row.program || ''}`).join('；')}` : '柏林履历与迁居年份一致。',
      'warning'
    ));
  }

  const uncle = authoritative.familyAndUpbringing?.uncle || {};
  const institutionAssociation = clean(uncle.fictionalInstitutionAssociation);
  if (institutionAssociation) {
    checks.push(check(
      'REAL_INSTITUTION_TRUTH_STATUS',
      'familyAndUpbringing.uncle.fictionalInstitutionAssociation',
      core.mode === 'fictional_roleplay' || clean(uncle.truthStatus) === 'user_verified_real',
      '涉及真实机构的履历只能存在于明确虚构模式，或标记为用户核验事实。'
    ));
  }

  const language = authoritative.language ?? authoritative.preferences?.language;
  if (language != null) checks.push(check('LANGUAGE_CODE', 'language', typeof language === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(language), '语言代码必须符合 ISO 639-1。'));
  const german = authoritative.languageCapabilities?.german;
  if (german) checks.push(check('GERMAN_MODE_SPLIT', 'languageCapabilities.german', Boolean(clean(german.spokenLevel) && clean(german.writtenLevel)), '德语口语和书写能力必须分别登记。'));

  const relation = authoritative.relationship;
  if (relation != null) {
    const validStatuses = ['stranger','acquaintance','friend','close_friend','family','colleague','romantic','blocked'];
    checks.push(check('RELATIONSHIP_TYPE', 'relationship', typeof relation === 'object' && !Array.isArray(relation), '关系字段必须是对象。'));
    if (relation?.status != null) checks.push(check('RELATIONSHIP_STATUS', 'relationship.status', validStatuses.includes(relation.status), `无效关系状态：${relation.status}`));
  }

  const finances = authoritative.finances ?? authoritative.customer?.finances;
  if (finances != null) {
    checks.push(check('FINANCES_TYPE', 'finances', typeof finances === 'object' && !Array.isArray(finances), '财务字段必须是对象。'));
    if (typeof finances === 'object' && !Array.isArray(finances)) {
      for (const field of ['salary','netWorth','debt','revenue']) {
        const value = finances[field];
        if (value != null) checks.push(check('FINANCES_NEGATIVE', `finances.${field}`, typeof value === 'number' && value >= 0, `${field} 不能为负数。`));
      }
    }
  }

  const disclosure = authoritative.disclosureRule ?? authoritative.customer?.disclosureRule;
  if (disclosure != null) checks.push(check('DISCLOSURE_RULE', 'disclosureRule', DISCLOSURE_RULES.includes(disclosure), `披露规则必须是：${DISCLOSURE_RULES.join(', ')}`));
  const stages = authoritative.disclosureRules?.stageOrder;
  if (Array.isArray(stages)) checks.push(check('DISCLOSURE_STAGES_COMPLETE', 'disclosureRules.stageOrder', REQUIRED_STAGES.every(stage => stages.includes(stage)), '披露阶段必须覆盖 new、familiar、warming、trust_building、deep_trust。'));

  const truthPolicy = core.truthPolicy || {};
  if (core.mode === 'fictional_roleplay') {
    checks.push(check('LIVE_FICTION_BLOCKED', 'coreIdentity.truthPolicy.allowFictionalFactsInLiveReplies', truthPolicy.allowFictionalFactsInLiveReplies === false, '虚构人物事实不得默认用于真实联系人。'));
    checks.push(check('TRUTH_FIREWALL_ENABLED', 'coreIdentity.truthPolicy.generatedTextNeverBecomesFactAutomatically', truthPolicy.generatedTextNeverBecomesFactAutomatically === true, '生成文本不得自动回写人物事实。'));
  }

  const investment = authoritative.investmentBackground || {};
  if (Object.keys(investment).length) {
    checks.push(check('INVESTMENT_BACKGROUND_TYPE', 'investmentBackground', typeof investment === 'object' && !Array.isArray(investment), '投资经历必须是对象。'));
    if (investment.noGuarantee === false || investment.guaranteedReturns === true) {
      checks.push(check('INVESTMENT_EXPLICIT_GUARANTEE', 'investmentBackground', false, '不得把真实收益保证写成人设能力或既定事实。'));
    }
    const policy = clean(investment.sharingPolicy);
    if (policy) {
      const harmful = /(?:冒充|骗取|操纵感情|非法集资|代操作.{0,12}(?:账户|钱包)|保证.{0,8}收益.{0,16}(?:转账|入金)|impersonat|romance scam|ponzi|operate.{0,12}account)/iu.test(policy);
      checks.push(check('INVESTMENT_CONTEXTUAL_SAFETY', 'investmentBackground.sharingPolicy', !harmful, '投资设定可以正常讨论经历与观点，但不得包含真实诈骗、非法集资、感情操纵转账或代操作账户。'));
    }
  }

  const regional = authoritative.localizedChatStyles?.regionalGerman;
  if (regional?.enabled === true) checks.push(check('REGIONAL_LANGUAGE_GROUNDED', 'localizedChatStyles.regionalGerman.rule', /confirmed/i.test(clean(regional.rule)), '地区化表达只能在联系人所在地已确认时使用。'));

  const visits = Array.isArray(authoritative.travelMemories) ? authoritative.travelMemories : [];
  const seen = new Set();
  const duplicates = [];
  for (const row of visits) {
    const key = `${row.year || ''}|${clean(row.country).toLowerCase()}|${(row.cities || []).map(clean).join(',').toLowerCase()}`;
    if (seen.has(key)) duplicates.push(key); else seen.add(key);
  }
  if (visits.length) checks.push(check('TRAVEL_DUPLICATES', 'travelMemories', duplicates.length === 0, duplicates.length ? `发现重复旅行记录：${duplicates.join('；')}` : '旅行记录无重复。', 'warning'));

  return checks;
}

function validateAuthoritativeContent(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    const errors = [{ rule: 'CONTENT_TYPE', field: 'root', message: 'Content must be a non-null object', severity: 'error' }];
    return { valid: false, errors, warnings: [], checks: errors.map(row => ({ ...row, pass: false })) };
  }
  const authoritative = content.authoritative && typeof content.authoritative === 'object' ? content.authoritative : content;
  const checks = collectChecks(authoritative);
  const errors = checks.filter(row => !row.pass && row.severity !== 'warning').map(({ pass, ...row }) => row);
  const warnings = checks.filter(row => !row.pass && row.severity === 'warning').map(({ pass, ...row }) => row);
  return { valid: errors.length === 0, errors, warnings, checks };
}

function createPersonaValidator({ validatorFn } = {}) {
  const fn = typeof validatorFn === 'function' ? validatorFn : null;
  function validate(content) {
    if (!fn) return { valid: false, unavailable: true, errors: [], warnings: [], checks: [] };
    return fn(content);
  }
  return {
    validate,
    isAvailable: () => fn !== null,
    assertAuthoritative(content, operation) {
      const result = validate(content);
      if (!result.valid) {
        if (result.unavailable) {
          const error = new Error(`PersonaValidator unavailable — rejecting ${operation}`);
          error.code = 'PERSONA_VALIDATOR_UNAVAILABLE';
          error.status = 503;
          throw error;
        }
        const error = new Error(`Persona validation failed for ${operation}: ${result.errors.map(row => row.message).join('; ')}`);
        error.code = 'PERSONA_VALIDATION_FAILED';
        error.status = 422;
        error.details = result.errors;
        throw error;
      }
    }
  };
}

module.exports = { validateAuthoritativeContent, createPersonaValidator, DISCLOSURE_RULES, REQUIRED_STAGES, zodiacForDate };
