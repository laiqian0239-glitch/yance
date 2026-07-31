'use strict';

const issueAggregator = require('../services/integrityIssueAggregator');
const { eligibleForTask } = require('../services/modelRoutingIntegrityService');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function violationIdentity(row = {}) {
  return [
    row.code, row.domain, row.entityId, row.contactId, row.taskId,
    row.task, row.role, row.modelId, row.outboxId
  ].map(clean).join('|');
}

function dedupeViolations(rows = []) {
  const unique = new Map();
  for (const row of rows) {
    const key = violationIdentity(row) || JSON.stringify(row);
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()];
}

class StoreIntegrityMonitor {
  constructor(options = {}) {
    if (!options.storeManager?.select) throw new TypeError('storeManager is required');
    this.storeManager = options.storeManager;
    this.logger = options.logger || console;
    this.onReport = typeof options.onReport === 'function' ? options.onReport : null;
    this.intervalMs = Math.max(5000, Number(options.intervalMs || 30000));
    this.timer = null;
    this.lastReport = { ok: true, checkedAt: '', violations: [] };
  }

  inspect() {
    const snapshot = this.storeManager.select(state => ({
      meta: state.meta,
      customers: state.customers,
      interactionPolicies: state.interactionPolicies,
      models: state.models,
      routing: state.routing,
      aiBrain: state.aiBrain,
      outbox: state.outbox
    }));
    const violations = [];
    const archived = new Set(snapshot.customers.archivedIds || []);
    for (const id of snapshot.customers.activeIds || []) {
      if (archived.has(id) || snapshot.customers.byId[id]?.archived || snapshot.customers.byId[id]?.archivedAt) {
        violations.push({ code: 'ARCHIVED_CUSTOMER_IN_ACTIVE_SET', contactId: id, severity: 'critical' });
      }
    }
    const currentId = clean(snapshot.customers.currentId);
    if (currentId && (archived.has(currentId) || snapshot.customers.byId[currentId]?.archived || snapshot.customers.byId[currentId]?.archivedAt)) {
      violations.push({ code: 'ARCHIVED_CUSTOMER_SELECTED', contactId: currentId, severity: 'critical' });
    }
    for (const [contactId, customer] of Object.entries(snapshot.customers.byId || {})) {
      const policy = snapshot.interactionPolicies.byContactId?.[contactId] || {};
      if ((customer.archived || customer.archivedAt) && (policy.allowReplies !== false || policy.allowProactive === true || policy.blocked !== true)) {
        violations.push({ code: 'ARCHIVE_POLICY_MISMATCH', contactId, severity: 'critical' });
      }
    }
    for (const [task, route] of Object.entries(snapshot.routing.byTask || {})) {
      for (const role of ['primary', 'fallback']) {
        const modelId = clean(route?.[role]);
        if (!modelId) continue;
        const model = snapshot.models.byId?.[modelId];
        if (!eligibleForTask(model, task, { allowExperimental: route?.allowExperimental === true })) {
          violations.push({
            code: 'UNQUALIFIED_ROUTABLE_MODEL',
            domain: 'model-routing',
            entityId: `${task}:${role}:${modelId}`,
            task,
            role,
            modelId,
            severity: 'high',
            title: '不合格模型仍存在于任务路由',
            detail: `${task} · ${role} → ${modelId}`
          });
        }
      }
    }
    for (const task of Object.values(snapshot.aiBrain.tasksById || {})) {
      if (!['queued', 'preflight', 'running', 'generated', 'awaiting_send_confirmation'].includes(task.status)) continue;
      const customer = snapshot.customers.byId?.[task.contactId];
      if (!customer || customer.archived || customer.archivedAt) {
        violations.push({ code: 'AI_TASK_REFERENCES_INELIGIBLE_CUSTOMER', taskId: task.taskId, contactId: task.contactId, severity: 'critical' });
      }
    }
    for (const item of Object.values(snapshot.outbox.byId || {})) {
      if (['sent', 'cancelled', 'failed'].includes(item.state)) continue;
      if (item.userApproved !== true) {
        violations.push({ code: 'OUTBOX_WITHOUT_USER_APPROVAL', outboxId: item.id, severity: 'critical' });
      }
    }
    const uniqueViolations = dedupeViolations(violations);
    const report = {
      ok: uniqueViolations.length === 0,
      stateVersion: Number(snapshot.meta?.stateVersion || 0),
      checkedAt: new Date().toISOString(),
      violations: uniqueViolations
    };
    let aggregate = { newCount: 0, active: [] };
    try { aggregate = issueAggregator.record(uniqueViolations); } catch (error) {
      this.logger.error?.('store', 'integrity-aggregation-failed', { error: error.message, code: error.code || '' });
    }
    report.aggregates = aggregate.active;
    this.lastReport = report;
    if (!report.ok && aggregate.newCount > 0) {
      this.logger.warn?.('store', 'integrity-violations-detected', {
        stateVersion: report.stateVersion,
        uniqueCount: aggregate.active.length,
        newCount: aggregate.newCount,
        violations: uniqueViolations
      });
    }
    this.onReport?.(report);
    return report;
  }

  start() {
    if (this.timer) return this.lastReport;
    this.inspect();
    this.timer = setInterval(() => this.inspect(), this.intervalMs);
    this.timer.unref?.();
    return this.lastReport;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { StoreIntegrityMonitor };
