'use strict';

const AUTHORITY = 'AIBudgetAuthority';
const SCHEMA_VERSION = 1;
const DEFAULT_POLICY = Object.freeze({
  totalBudgetUsd: 15,
  championReserveUsd: 5,
  backgroundPaidEnabled: true
});
const FORMAL_REPLY_TASKS = new Set(['quick_reply', 'deep_reply', 'director']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }
function normalizePolicy(value = {}) {
  const totalBudgetUsd = number(value.totalBudgetUsd ?? DEFAULT_POLICY.totalBudgetUsd);
  const championReserveUsd = number(value.championReserveUsd ?? DEFAULT_POLICY.championReserveUsd);
  const valid = totalBudgetUsd !== null && championReserveUsd !== null && championReserveUsd <= totalBudgetUsd;
  return {
    valid,
    totalBudgetUsd: valid ? totalBudgetUsd : DEFAULT_POLICY.totalBudgetUsd,
    championReserveUsd: valid ? championReserveUsd : DEFAULT_POLICY.championReserveUsd,
    backgroundPaidEnabled: value.backgroundPaidEnabled !== false
  };
}
function normalizeUsage(value = {}) {
  const raw = Object.prototype.hasOwnProperty.call(value, 'spentUsd') ? value.spentUsd : 0;
  const spentUsd = number(raw);
  return { valid: spentUsd !== null, spentUsd: spentUsd === null ? 0 : spentUsd, periodStartedAt: clean(value.periodStartedAt) };
}
function normalizedTask(value) {
  const task = clean(value);
  return task === 'reply' || task === 'standard_reply' ? 'quick_reply' : task;
}
function decide(document = {}, context = {}) {
  const task = normalizedTask(context.task);
  const modelCostClass = clean(context.modelCostClass);
  const translationProfile = clean(context.translationProfile).toLowerCase();
  const background = context.background === true;
  const policy = normalizePolicy(document.aiBudgetPolicy || {});
  const usage = normalizeUsage(document.aiBudgetUsage || {});
  const remainingUsd = Math.max(0, policy.totalBudgetUsd - usage.spentUsd);
  const base = {
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    task,
    modelCostClass,
    translationProfile,
    background,
    policy,
    usage,
    remainingUsd,
    reserveUsd: policy.championReserveUsd
  };
  if (modelCostClass === 'local' || modelCostClass === 'free-cloud') {
    return { ...base, pass: true, reasonCode: 'AI_NON_PAID_WORKLOAD_ALLOWED' };
  }
  if (FORMAL_REPLY_TASKS.has(task)) {
    return { ...base, pass: true, reasonCode: policy.valid && usage.valid ? 'AI_CHAMPION_RESERVE_ALLOWED' : 'AI_CHAMPION_BUDGET_STATE_UNKNOWN_ALLOWED' };
  }
  if (task === 'translation' && translationProfile === 'outbound' && !background) {
    return { ...base, pass: true, reasonCode: policy.valid && usage.valid ? 'AI_QUALITY_RESERVE_ALLOWED' : 'AI_QUALITY_BUDGET_STATE_UNKNOWN_ALLOWED' };
  }
  if (!policy.valid || !usage.valid) return { ...base, pass: false, reasonCode: 'AI_BUDGET_STATE_INVALID' };
  if (!policy.backgroundPaidEnabled) return { ...base, pass: false, reasonCode: 'AI_BACKGROUND_PAID_DISABLED' };
  if (remainingUsd <= policy.championReserveUsd) return { ...base, pass: false, reasonCode: 'AI_BACKGROUND_PAID_BUDGET_PROTECTED' };
  return { ...base, pass: true, reasonCode: 'AI_BACKGROUND_PAID_BUDGET_AVAILABLE' };
}

module.exports = { AUTHORITY, SCHEMA_VERSION, DEFAULT_POLICY, normalizePolicy, normalizeUsage, decide };
