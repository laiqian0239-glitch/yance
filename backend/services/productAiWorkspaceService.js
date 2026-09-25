'use strict';

const crypto = require('node:crypto');
const { getStore } = require('../repositories/storeProvider');
const workspaceRepository = require('../repositories/workspaceRepository');
const aiGateway = require('./aiGateway');

const META_KEY = 'product.ai_workspace.v4';
const MAX_TASKS = 80;
const MAX_CONTACTS = 50;
const MAX_MESSAGES_PER_CONVERSATION = 120;
const REASONING = new Set(['minimum','low','medium','high','very_high','maximum','ultra']);

function clean(value, max = 4000) { return String(value == null ? '' : value).trim().slice(0, max); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function unique(values, limit = MAX_CONTACTS) { return [...new Set(array(values).map(value => clean(value, 240)).filter(Boolean))].slice(0, limit); }
function integer(value, fallback, min, max) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback; }
function aiError(code, message, status = 400) { return Object.assign(new Error(message), { code, status }); }

function parseStructured(value) {
  const row = object(value);
  if (Object.keys(object(row.structured)).length) return object(row.structured);
  if (Object.keys(object(row.result)).length) return object(row.result);
  const rawText = clean(row.text || row.content || row.output, 200000);
  if (!rawText) return {};
  try { return object(JSON.parse(rawText)); } catch (_) { return {}; }
}
function evidenceId(value) {
  const row = object(value);
  return clean(row.messageId || row.id || row.eventId || row.sourceMessageId || row.platformMessageId, 240);
}

function createProductAiWorkspaceService(options = {}) {
  const store = options.store || getStore();
  const workspaceData = options.workspaceData || workspaceRepository;
  const gateway = options.aiGateway || aiGateway;
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString();
  const idFactory = typeof options.idFactory === 'function' ? options.idFactory : () => crypto.randomUUID();

  function readDocument() {
    const raw = object(store.getMeta(META_KEY, {}));
    return { schemaVersion: 1, tasks: array(raw.tasks).map(object).filter(row => clean(row.id)).slice(0, MAX_TASKS) };
  }
  function writeDocument(document) {
    const next = { schemaVersion: 1, updatedAt: clock(), tasks: array(document.tasks).slice(0, MAX_TASKS) };
    store.setMeta(META_KEY, next);
    return next;
  }
  function normalizeTask(input = {}, previous = {}) {
    if (input.autoSend === true) throw aiError('AI_WORKSPACE_AUTO_SEND_FORBIDDEN', 'AI Workspace auto-send is forbidden');
    const createdAt = clean(previous.createdAt) || clock();
    const reasoning = clean(input.reasoningStrength ?? previous.reasoningStrength, 32) || 'medium';
    return {
      ...previous,
      id: clean(input.id ?? previous.id, 240) || clean(idFactory(), 240),
      title: clean(input.title ?? previous.title, 120) || '新的 AI 任务',
      prompt: clean(input.prompt ?? previous.prompt, 4000),
      contactIds: unique(input.contactIds ?? previous.contactIds),
      timeRangeDays: integer(input.timeRangeDays ?? previous.timeRangeDays, 7, 1, 365),
      resultLimit: integer(input.resultLimit ?? previous.resultLimit, 5, 1, 10),
      modelId: clean(input.modelId ?? previous.modelId, 300),
      reasoningStrength: REASONING.has(reasoning) ? reasoning : 'medium',
      includeRealConversation: input.includeRealConversation == null ? previous.includeRealConversation !== false : input.includeRealConversation === true,
      includeSharedMoments: input.includeSharedMoments == null ? previous.includeSharedMoments !== false : input.includeSharedMoments === true,
      includeMemoryOpenLoops: input.includeMemoryOpenLoops == null ? previous.includeMemoryOpenLoops !== false : input.includeMemoryOpenLoops === true,
      includeGoals: input.includeGoals == null ? previous.includeGoals !== false : input.includeGoals === true,
      citeSources: input.citeSources == null ? previous.citeSources !== false : input.citeSources === true,
      distinguishFacts: input.distinguishFacts == null ? previous.distinguishFacts !== false : input.distinguishFacts === true,
      autoSend: false,
      saved: input.saved == null ? previous.saved === true : input.saved === true,
      createdAt,
      updatedAt: clock(),
      lastRunAt: clean(previous.lastRunAt),
      lastRunStatus: clean(previous.lastRunStatus),
      lastRunError: clean(previous.lastRunError, 1000),
      ...(previous.lastResult ? { lastResult: previous.lastResult } : {})
    };
  }

  function listTasks() {
    return readDocument().tasks.slice().sort((a, b) => clean(b.lastRunAt || b.updatedAt).localeCompare(clean(a.lastRunAt || a.updatedAt)));
  }
  function getTask(id) { return listTasks().find(row => clean(row.id) === clean(id)) || null; }

  function createTask(input = {}) {
    const document = readDocument();
    const task = normalizeTask(input);
    if (document.tasks.some(row => clean(row.id) === task.id)) throw aiError('AI_WORKSPACE_TASK_EXISTS', 'AI Workspace task already exists', 409);
    document.tasks.unshift(task);
    writeDocument(document);
    return task;
  }

  function updateTask(id, input = {}) {
    const taskId = clean(id, 240);
    const document = readDocument();
    const index = document.tasks.findIndex(row => clean(row.id) === taskId);
    if (index < 0) throw aiError('AI_WORKSPACE_TASK_NOT_FOUND', 'AI Workspace task not found', 404);
    const task = normalizeTask({ ...input, id: taskId }, document.tasks[index]);
    document.tasks[index] = task;
    writeDocument(document);
    return task;
  }

  function scopedContacts(task) {
    const all = array(workspaceData.listContacts({ limit: 500 })).map(object);
    const byId = new Map(all.map(row => [clean(row.id), row]).filter(([id]) => id));
    const requested = task.contactIds.length ? task.contactIds : [...byId.keys()];
    return requested.map(id => byId.get(id)).filter(Boolean).slice(0, MAX_CONTACTS);
  }

  function sourceRows(task) {
    const now = Date.parse(clock());
    const cutoff = Number.isFinite(now) ? now - task.timeRangeDays * 86400000 : 0;
    return scopedContacts(task).map(contact => {
      const contactId = clean(contact.id);
      const context = object(workspaceData.getContactContext(contactId));
      const contextContact = object(context.contact);
      const insights = object(context.insights);
      const conversations = array(context.conversations).map(object);
      const messages = [];
      if (task.includeRealConversation) {
        for (const conversation of conversations.slice(0, 8)) {
          const sessionKey = clean(conversation.sessionKey || conversation.conversationId);
          if (!sessionKey) continue;
          for (const message of array(workspaceData.latestMessages(sessionKey, MAX_MESSAGES_PER_CONVERSATION)).map(object)) {
            const at = Date.parse(clean(message.sentAt));
            if (cutoff && Number.isFinite(at) && at < cutoff) continue;
            messages.push({
              id: clean(message.id || message.platformMessageId, 240),
              conversationId: sessionKey,
              text: clean(message.sourceText || message.text, 1200),
              sentAt: clean(message.sentAt, 64),
              fromMe: message.fromMe === true
            });
          }
        }
      }
      return {
        contactId,
        name: clean(contextContact.displayName || contextContact.name || contact.displayName || contact.name, 160) || '未命名联系人',
        relationship: {
          summary: clean(insights.summary, 1600),
          stage: clean(insights.relationshipStage || insights.stage, 120),
          momentum: clean(insights.momentum, 120),
          openLoops: task.includeMemoryOpenLoops ? array(insights.openLoops).slice(0, 20) : [],
          evidence: array(insights.evidence).slice(0, 30)
        },
        conversations: conversations.slice(0, 8).map(row => ({ id: clean(row.sessionKey || row.conversationId, 240), title: clean(row.title, 200), lastMessage: clean(row.lastMessage, 600), lastMessageAt: clean(row.lastMessageAt, 64) })),
        messages: messages.slice(-240)
      };
    });
  }

  function allowedEvidence(source) {
    const ids = new Set();
    for (const message of source.messages) if (clean(message.id)) ids.add(clean(message.id));
    for (const evidence of array(source.relationship.evidence)) {
      const id = evidenceId(evidence);
      if (id) ids.add(id);
    }
    return ids;
  }

  function validateResult(raw, task, sources, runtimeResult = {}) {
    const structured = parseStructured(raw);
    const sourceById = new Map(sources.map(source => [source.contactId, source]));
    const ranked = [];
    for (const candidate of array(structured.ranked).map(object)) {
      const contactId = clean(candidate.contactId, 240);
      const source = sourceById.get(contactId);
      if (!source) continue;
      const allowed = allowedEvidence(source);
      const refs = unique(candidate.evidenceRefs, 40).filter(id => allowed.has(id));
      ranked.push({
        contactId,
        name: source.name,
        reason: clean(candidate.reason, 1200),
        signals: array(candidate.signals).map(value => clean(value, 240)).filter(Boolean).slice(0, 12),
        evidenceRefs: refs,
        conversationId: clean(source.conversations[0]?.id, 240),
        stage: clean(source.relationship.stage, 120),
        momentum: clean(source.relationship.momentum, 120)
      });
      if (ranked.length >= task.resultLimit) break;
    }
    if (!ranked.length) throw aiError('AI_WORKSPACE_RESULT_UNTRUSTED', 'AI Workspace result did not map to canonical contacts', 502);
    return {
      summary: clean(structured.summary, 3000),
      ranked,
      modelId: clean(runtimeResult.modelId || raw.modelId || task.modelId, 300),
      model: clean(runtimeResult.model || raw.model, 300),
      completedAt: clock(),
      boundary: { autoSend: false, promotesAnalysisToFact: false, citeSources: task.citeSources, distinguishFacts: task.distinguishFacts }
    };
  }

  async function runTask(id) {
    const task = getTask(id);
    if (!task) throw aiError('AI_WORKSPACE_TASK_NOT_FOUND', 'AI Workspace task not found', 404);
    const sources = sourceRows(task);
    if (!sources.length) throw aiError('AI_WORKSPACE_SOURCE_EMPTY', 'AI Workspace has no canonical contacts in scope', 400);
    const messages = [
      {
        role: 'system',
        content: [
          'You are Yance relationship analysis.',
          'Return strict JSON with keys summary and ranked.',
          'ranked[] fields: contactId, reason, signals, evidenceRefs.',
          'Use only supplied canonical contacts and evidence IDs.',
          'Never invent facts and never send messages.'
        ].join(' ')
      },
      {
        role: 'user',
        content: JSON.stringify({
          prompt: task.prompt,
          constraints: {
            citeSources: task.citeSources,
            distinguishFacts: task.distinguishFacts,
            includeSharedMoments: task.includeSharedMoments,
            includeGoals: task.includeGoals,
            resultLimit: task.resultLimit
          },
          contacts: sources
        })
      }
    ];
    try {
      const runtimeResult = await gateway.execute({
        task: 'relationship',
        messages,
        modelId: task.modelId,
        options: {
          json: true,
          reasoningLevel: task.reasoningStrength
        },
        context: {
          scopeKey: `ai-workspace:${task.id}`,
          generation: `${task.updatedAt || task.createdAt || clock()}`
        }
      });
      const result = validateResult(runtimeResult, task, sources, runtimeResult);
      const document = readDocument();
      const index = document.tasks.findIndex(row => clean(row.id) === task.id);
      if (index >= 0) {
        document.tasks[index] = {
          ...document.tasks[index],
          lastRunAt: result.completedAt,
          lastRunStatus: 'completed',
          lastRunError: '',
          lastResult: result,
          updatedAt: clock()
        };
        writeDocument(document);
      }
      return result;
    } catch (error) {
      const document = readDocument();
      const index = document.tasks.findIndex(row => clean(row.id) === task.id);
      if (index >= 0) {
        document.tasks[index] = {
          ...document.tasks[index],
          lastRunAt: clock(),
          lastRunStatus: 'failed',
          lastRunError: clean(error?.message || error, 1000),
          updatedAt: clock()
        };
        writeDocument(document);
      }
      throw error;
    }
  }

  return Object.freeze({
    listTasks,
    getTask,
    createTask,
    updateTask,
    runTask
  });
}

const productAiWorkspaceService = {
  listTasks: (...args) => createProductAiWorkspaceService().listTasks(...args),
  getTask: (...args) => createProductAiWorkspaceService().getTask(...args),
  createTask: (...args) => createProductAiWorkspaceService().createTask(...args),
  updateTask: (...args) => createProductAiWorkspaceService().updateTask(...args),
  runTask: (...args) => createProductAiWorkspaceService().runTask(...args)
};

module.exports = productAiWorkspaceService;
module.exports.createProductAiWorkspaceService = createProductAiWorkspaceService;
module.exports.META_KEY = META_KEY;
